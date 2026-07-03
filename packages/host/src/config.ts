import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as pathResolve, sep } from "node:path";
import type { ProviderMode, SkillContent } from "@sumeru/adapter-core";
import type {
	CustomProvider,
	Extension,
	HostConfig,
	ModelConfig,
	Persona,
	ProviderApiType,
} from "@sumeru/core";
import { parse as parseYaml } from "yaml";
import {
	ensureDataDirs,
	loadExtensionsFromDisk,
	loadPrototypeInfo,
	loadPrototypesFromDisk,
	readExtensionFile,
} from "./data-store.js";
import {
	discoverDockerPrototypeByName,
	discoverDockerPrototypes,
	mergeDockerWithYaml,
} from "./docker-prototypes.js";
import { logger, TAG_CFG } from "./logger.js";
import { openDatabase, type SqliteStore } from "./sqlite-store.js";
import type {
	LoadedHostConfig,
	PrototypeInfo,
	SessionModelOverride,
} from "./types.js";

const DEFAULT_HOST_FILE = "host.yaml";
const DEFAULT_DATA_DIR = "data";

export async function loadHostConfig(
	rootDir: string,
): Promise<LoadedHostConfig> {
	const configPath = join(rootDir, DEFAULT_HOST_FILE);
	const raw = await readFileSafely(configPath);
	// Pass 1: light-parse envFile so we can populate process.env before expansion
	const envFilePath = extractEnvFilePath(raw);
	if (envFilePath !== null) {
		await applyEnvFile(envFilePath);
	}
	// Pass 2: expand ${VAR} / ${VAR:-default} references against process.env
	const expanded = expandEnvVars(raw, configPath);
	const doc = parseYamlSafely(expanded, configPath);
	const config = validateHostConfig(doc, configPath);
	const dataDir = join(rootDir, DEFAULT_DATA_DIR);
	const skillsDir = join(dataDir, "skills");
	const prototypesDir = join(dataDir, "prototypes");
	const extensionsDir = join(dataDir, "extensions");
	await ensureDataDirs(skillsDir, prototypesDir, extensionsDir);
	const prototypes = await loadAllPrototypes({
		rootDir,
		prototypesDir,
		skillsDir,
	});
	const extensions = await loadExtensionsFromDisk({ extensionsDir });
	for (const info of prototypes.values()) {
		if (info.composePath !== null) {
			await validateComposeProjectVolume(info.composePath);
		}
	}
	const sqliteStore = openDatabase(join(dataDir, "sumeru.db"));
	await importSkillsFromFiles(sqliteStore, skillsDir);
	return {
		rootDir,
		configPath,
		dataDir,
		skillsDir,
		prototypesDir,
		extensionsDir,
		config,
		prototypes,
		extensions,
		sqliteStore,
	};
}

export async function reloadExtensionInConfig(
	hostConfig: LoadedHostConfig,
	name: string,
): Promise<Extension> {
	const extension = await readExtensionFile(hostConfig.extensionsDir, name);
	hostConfig.extensions.set(name, extension);
	return extension;
}

export async function reloadPrototypeInConfig(
	hostConfig: LoadedHostConfig,
	name: string,
): Promise<PrototypeInfo> {
	const dockerInfo =
		process.env.VITEST === "true"
			? null
			: await discoverDockerPrototypeByName(name);
	if (dockerInfo !== null) {
		let yamlInfo: PrototypeInfo | null = null;
		try {
			yamlInfo = await loadPrototypeInfo(toStoreInput(hostConfig), name);
		} catch {
			yamlInfo = null;
		}
		const info = mergeDockerWithYaml(dockerInfo, yamlInfo);
		hostConfig.prototypes.set(name, info);
		return info;
	}
	const info = await loadPrototypeInfo(toStoreInput(hostConfig), name);
	if (info.composePath !== null) {
		await validateComposeProjectVolume(info.composePath);
	}
	hostConfig.prototypes.set(name, info);
	return info;
}

export async function removePrototypeFromConfig(
	hostConfig: LoadedHostConfig,
	name: string,
): Promise<void> {
	hostConfig.prototypes.delete(name);
}

function toStoreInput(hostConfig: LoadedHostConfig): {
	rootDir: string;
	prototypesDir: string;
	skillsDir: string;
} {
	return {
		rootDir: hostConfig.rootDir,
		prototypesDir: hostConfig.prototypesDir,
		skillsDir: hostConfig.skillsDir,
	};
}

async function loadAllPrototypes(input: {
	rootDir: string;
	prototypesDir: string;
	skillsDir: string;
}): Promise<Map<string, PrototypeInfo>> {
	const yamlPrototypes = await loadPrototypesFromDisk(input);
	const dockerPrototypes =
		process.env.VITEST === "true"
			? new Map<string, PrototypeInfo>()
			: await discoverDockerPrototypes();
	const merged = new Map<string, PrototypeInfo>();
	for (const [name, info] of yamlPrototypes) {
		merged.set(name, info);
	}
	for (const [name, dockerInfo] of dockerPrototypes) {
		const yamlInfo = merged.get(name) ?? null;
		merged.set(name, mergeDockerWithYaml(dockerInfo, yamlInfo));
	}
	return merged;
}

export function loadPrototypeInitSkills(
	sqliteStore: SqliteStore,
	persona: Persona,
): Array<SkillContent> {
	const skills: Array<SkillContent> = [];
	for (const skillName of persona.skills) {
		const skill = sqliteStore.getSkill(skillName);
		skills.push({ name: skillName, content: skill?.content ?? "" });
	}
	return skills;
}

const DEFAULT_ENDPOINTS: Record<ProviderApiType, string> = {
	anthropic: "https://api.anthropic.com",
	openai: "https://api.openai.com/v1",
};

export function resolveSessionModel(
	sqliteStore: SqliteStore,
	prototypeModelId: string | null,
	override: SessionModelOverride,
	providerMode: ProviderMode,
	defaultModel: string | null = null,
): ModelConfig {
	if (
		providerMode === "builtin-only" &&
		prototypeModelId === null &&
		override === null
	) {
		return {
			provider: { name: "builtin", endpoint: "", apiType: "openai" },
			name: "auto",
			apiKey: null,
		};
	}
	if (override !== null && typeof override !== "string") {
		return { provider: override.provider, name: override.name, apiKey: null };
	}
	const modelId =
		typeof override === "string"
			? override
			: (prototypeModelId ?? defaultModel);
	if (modelId === null) {
		throw new Error("model_required");
	}

	const colonIdx = modelId.indexOf(":");
	if (colonIdx === -1) {
		throw new Error(`model_invalid_format:${modelId} (expected provider:name)`);
	}
	const providerName = modelId.slice(0, colonIdx);
	const modelName = modelId.slice(colonIdx + 1);

	const model = sqliteStore.getModel(providerName, modelName);
	if (model === null) {
		throw new Error(`model_not_found:${modelId}`);
	}
	const provider = sqliteStore.getProvider(model.provider);
	if (provider === null) {
		throw new Error(`provider_not_found:${model.provider}`);
	}
	const apiKey = sqliteStore.getProviderApiKey(model.provider);
	const endpoint =
		provider.baseUrl ?? DEFAULT_ENDPOINTS[provider.apiType] ?? null;
	const custom: CustomProvider = {
		name: provider.name,
		endpoint: endpoint ?? DEFAULT_ENDPOINTS.anthropic,
		apiType: provider.apiType,
	};
	return { provider: custom, name: model.model, apiKey };
}

export type ResolveProjectResult =
	| { ok: true; project: string; projectPath: string }
	| { ok: false; message: string };

export function resolveProjectPath(
	workspaceRoot: string,
	rawProject: string,
): ResolveProjectResult {
	if (rawProject.length === 0) {
		return { ok: false, message: 'Field "project" must be a non-empty string' };
	}
	const root = pathResolve(workspaceRoot);
	const resolved = pathResolve(root, rawProject);
	if (resolved !== root && !resolved.startsWith(root + sep)) {
		return {
			ok: false,
			message: `project '${rawProject}' resolves outside workspaceRoot '${workspaceRoot}'`,
		};
	}
	if (!isAbsolute(resolved)) {
		return {
			ok: false,
			message: `project '${rawProject}' must resolve to an absolute path`,
		};
	}
	return { ok: true, project: rawProject, projectPath: resolved };
}

export async function extractImageFromCompose(
	composePath: string,
): Promise<string> {
	const raw = await readFile(composePath, "utf-8");
	const doc = parseYamlSafely(raw, composePath);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		return "unknown";
	}
	const services = (doc as Record<string, unknown>).services;
	if (
		services === null ||
		typeof services !== "object" ||
		Array.isArray(services)
	) {
		return "unknown";
	}
	for (const service of Object.values(services as Record<string, unknown>)) {
		if (
			service === null ||
			typeof service !== "object" ||
			Array.isArray(service)
		) {
			continue;
		}
		const image = (service as Record<string, unknown>).image;
		if (typeof image === "string" && image.length > 0) {
			return image;
		}
	}
	return "unknown";
}

const COMPOSE_PROJECT_VOLUME = "$" + "{SUMERU_PROJECT_PATH}";

export async function validateComposeProjectVolume(
	composePath: string,
): Promise<void> {
	const raw = await readFile(composePath, "utf-8");
	const doc = parseYamlSafely(raw, composePath);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(
			`Compose ${composePath} must be a YAML mapping with a services section`,
		);
	}
	const services = (doc as Record<string, unknown>).services;
	if (
		services === null ||
		typeof services !== "object" ||
		Array.isArray(services)
	) {
		throw new Error(
			`Compose ${composePath} must declare services with a project volume mount`,
		);
	}
	for (const service of Object.values(services as Record<string, unknown>)) {
		if (
			service === null ||
			typeof service !== "object" ||
			Array.isArray(service)
		) {
			continue;
		}
		const volumes = (service as Record<string, unknown>).volumes;
		if (!Array.isArray(volumes)) {
			continue;
		}
		for (const entry of volumes) {
			if (typeof entry === "string" && entry.includes(COMPOSE_PROJECT_VOLUME)) {
				return;
			}
		}
	}
	throw new Error(
		`Compose ${composePath} must bind-mount "${COMPOSE_PROJECT_VOLUME}:${COMPOSE_PROJECT_VOLUME}" on at least one service so adapter cwd exists in the container (issue #171)`,
	);
}

export function parseDotenvContent(raw: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of raw.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq <= 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
}

async function loadEnvFile(
	envFilePath: string,
): Promise<Record<string, string>> {
	const expanded = expandHome(envFilePath);
	try {
		const raw = await readFile(expanded, "utf-8");
		return parseDotenvContent(raw);
	} catch {
		return {};
	}
}

export async function mergeSessionEnv(
	hostEnvFile: string,
	sessionEnv: Record<string, string> | null,
): Promise<Record<string, string>> {
	const merged = await loadEnvFile(hostEnvFile);
	if (sessionEnv !== null) {
		for (const [key, value] of Object.entries(sessionEnv)) {
			merged[key] = value;
		}
	}
	return merged;
}

export { computePrototypeHash } from "./data-store.js";

function validateHostConfig(doc: unknown, path: string): HostConfig {
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(`Config ${path} must be a YAML mapping at the top level`);
	}
	const obj = doc as Record<string, unknown>;
	const name = obj.name;
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(
			`Config ${path} is missing required field "name" (must be a non-empty string)`,
		);
	}
	const maxRunning = obj.maxRunning;
	if (typeof maxRunning !== "number" || !Number.isFinite(maxRunning)) {
		throw new Error(
			`Config ${path} field "maxRunning" must be a finite number`,
		);
	}
	const workspaceRoot = obj.workspaceRoot;
	if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
		throw new Error(
			`Config ${path} field "workspaceRoot" must be a non-empty string`,
		);
	}
	const envFile = obj.envFile;
	if (typeof envFile !== "string" || envFile.length === 0) {
		throw new Error(
			`Config ${path} field "envFile" must be a non-empty string`,
		);
	}
	if (obj.models !== undefined && obj.models !== null) {
		logger.warn(
			TAG_CFG,
			`${path}: "models" section is deprecated — use SQLite Provider/Model entities instead`,
		);
	}
	if (obj.resourceLimits !== undefined && obj.resourceLimits !== null) {
		logger.warn(
			TAG_CFG,
			`${path}: "resourceLimits" section is deprecated and ignored`,
		);
	}
	return {
		name,
		maxRunning,
		workspaceRoot,
		envFile,
		defaults: parseHostDefaults(obj.defaults, path),
	};
}

function parseHostDefaults(
	value: unknown,
	path: string,
): HostConfig["defaults"] {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Config ${path} field "defaults" must be a mapping`);
	}
	const obj = value as Record<string, unknown>;

	let model: string | null = null;
	if (obj.model !== undefined && obj.model !== null) {
		if (typeof obj.model !== "string" || obj.model.length === 0) {
			throw new Error(
				`Config ${path} field "defaults.model" must be a non-empty string (format: provider:name)`,
			);
		}
		model = obj.model;
	}

	let timeout = 300;
	if (obj.timeout !== undefined) {
		if (typeof obj.timeout !== "number" || !Number.isFinite(obj.timeout)) {
			throw new Error(
				`Config ${path} field "defaults.timeout" must be a finite number`,
			);
		}
		timeout = obj.timeout;
	}

	let maxTurns = 30;
	if (obj.maxTurns !== undefined) {
		if (typeof obj.maxTurns !== "number" || !Number.isFinite(obj.maxTurns)) {
			throw new Error(
				`Config ${path} field "defaults.maxTurns" must be a finite number`,
			);
		}
		maxTurns = obj.maxTurns;
	}

	let cpu = 1;
	let memory = "2Gi";
	if (obj.resources !== undefined && obj.resources !== null) {
		if (typeof obj.resources !== "object" || Array.isArray(obj.resources)) {
			throw new Error(
				`Config ${path} field "defaults.resources" must be a mapping`,
			);
		}
		const resourcesObj = obj.resources as Record<string, unknown>;
		if (resourcesObj.cpu !== undefined) {
			if (
				typeof resourcesObj.cpu !== "number" ||
				!Number.isFinite(resourcesObj.cpu)
			) {
				throw new Error(
					`Config ${path} field "defaults.resources.cpu" must be a finite number`,
				);
			}
			cpu = resourcesObj.cpu;
		}
		if (resourcesObj.memory !== undefined) {
			if (
				typeof resourcesObj.memory !== "string" ||
				resourcesObj.memory.length === 0
			) {
				throw new Error(
					`Config ${path} field "defaults.resources.memory" must be a non-empty string`,
				);
			}
			memory = resourcesObj.memory;
		}
	}

	return { model, timeout, maxTurns, resources: { cpu, memory } };
}

async function importSkillsFromFiles(
	store: SqliteStore,
	skillsDir: string,
): Promise<void> {
	if (store.listSkills().length > 0) return;
	let entries: Array<string>;
	try {
		const dirEntries = await readdir(skillsDir, { withFileTypes: true });
		entries = dirEntries
			.filter((e) => e.isFile() && e.name.endsWith(".md"))
			.map((e) => e.name);
	} catch {
		return;
	}
	if (entries.length === 0) return;
	for (const fileName of entries) {
		const name = fileName.slice(0, -".md".length);
		const content = await readFile(join(skillsDir, fileName), "utf-8");
		store.createSkill({ name, content });
	}
}

/**
 * Light regex extraction of envFile from raw YAML text (before full parse).
 * Returns null if the field isn't found so the caller can skip applyEnvFile.
 */
function extractEnvFilePath(raw: string): string | null {
	const match = raw.match(/^envFile:\s*(.+)$/m);
	if (match === null) return null;
	let value = match[1].trim();
	// Strip optional YAML quotes
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}
	return value.length > 0 ? value : null;
}

async function applyEnvFile(envFilePath: string): Promise<void> {
	const vars = await loadEnvFile(envFilePath);
	for (const [key, value] of Object.entries(vars)) {
		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	}
}

function expandHome(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

async function readFileSafely(path: string): Promise<string> {
	try {
		return await readFile(path, "utf-8");
	} catch (err) {
		const code =
			err instanceof Error && "code" in err
				? (err as { code: unknown }).code
				: null;
		if (code === "ENOENT") {
			throw new Error(`File not found: ${path}`);
		}
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Cannot read file ${path}: ${msg}`);
	}
}

function parseYamlSafely(raw: string, path: string): unknown {
	try {
		return parseYaml(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid YAML in ${path}: ${msg}`);
	}
}

/**
 * Expand ${VAR} and ${VAR:-default} in raw YAML text.
 * Throws if a variable has no default and is not set in process.env.
 */
export function expandEnvVars(raw: string, context: string): string {
	const pattern = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;
	return raw.replace(
		pattern,
		(_match, varName: string, defaultVal?: string) => {
			const envVal = process.env[varName];
			if (envVal !== undefined) return envVal;
			if (defaultVal !== undefined) return defaultVal;
			throw new Error(
				`${context}: environment variable \${${varName}} is not set and has no default`,
			);
		},
	);
}
