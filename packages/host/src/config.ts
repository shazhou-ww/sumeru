import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as pathResolve, sep } from "node:path";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SkillContent } from "@sumeru/adapter-core";
import type {
	CustomProvider,
	HostConfig,
	Image,
	KnownProvider,
	ModelConfig,
	Prototype,
} from "@sumeru/core";
import { parse as parseYaml } from "yaml";
import {
	computePrototypeHash,
	ensureDataDirs,
	loadPrototypeInfo,
	loadPrototypesFromDisk,
} from "./data-store.js";
import type { LoadedHostConfig, PrototypeInfo } from "./types.js";

const DEFAULT_HOST_FILE = "host.yaml";
const DEFAULT_IMAGES_FILE = "images.yaml";
const DEFAULT_DATA_DIR = "data";

export async function loadHostConfig(
	rootDir: string,
): Promise<LoadedHostConfig> {
	const configPath = join(rootDir, DEFAULT_HOST_FILE);
	const raw = await readFileSafely(configPath);
	const doc = parseYamlSafely(raw, configPath);
	const config = validateHostConfig(doc, configPath);
	await applyEnvFile(config.envFile);
	const dataDir = join(rootDir, DEFAULT_DATA_DIR);
	const skillsDir = join(dataDir, "skills");
	const prototypesDir = join(dataDir, "prototypes");
	await ensureDataDirs(skillsDir, prototypesDir);
	const prototypes = await loadPrototypesFromDisk({
		rootDir,
		prototypesDir,
		skillsDir,
	});
	const images = await loadImagesConfig(rootDir, doc, configPath);
	return {
		rootDir,
		configPath,
		dataDir,
		skillsDir,
		prototypesDir,
		config,
		prototypes,
		images,
	};
}

export async function reloadPrototypeInConfig(
	hostConfig: LoadedHostConfig,
	name: string,
): Promise<PrototypeInfo> {
	const info = await loadPrototypeInfo(toStoreInput(hostConfig), name);
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

async function loadImagesConfig(
	rootDir: string,
	hostDoc: unknown,
	hostConfigPath: string,
): Promise<Map<string, Image>> {
	if (
		hostDoc !== null &&
		typeof hostDoc === "object" &&
		!Array.isArray(hostDoc)
	) {
		const embedded = (hostDoc as Record<string, unknown>).images;
		if (embedded !== undefined && embedded !== null) {
			return parseImagesMapping(embedded, hostConfigPath);
		}
	}
	const imagesPath = join(rootDir, DEFAULT_IMAGES_FILE);
	try {
		const raw = await readFile(imagesPath, "utf-8");
		const doc = parseYamlSafely(raw, imagesPath);
		if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
			throw new Error(
				`Config ${imagesPath} must be a YAML mapping at the top level`,
			);
		}
		const obj = doc as Record<string, unknown>;
		const imagesRaw = obj.images ?? obj;
		return parseImagesMapping(imagesRaw, imagesPath);
	} catch (err) {
		const code =
			err instanceof Error && "code" in err
				? (err as { code: unknown }).code
				: null;
		if (code === "ENOENT") {
			return new Map();
		}
		throw err;
	}
}

function parseImagesMapping(value: unknown, path: string): Map<string, Image> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Config ${path} field "images" must be a mapping`);
	}
	const images = new Map<string, Image>();
	for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
		if (name.length === 0) {
			throw new Error(`Config ${path} image name must be a non-empty string`);
		}
		images.set(name, validateImageEntry(name, entry, `${path} images.${name}`));
	}
	return images;
}

function validateImageEntry(
	name: string,
	value: unknown,
	label: string,
): Image {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a mapping`);
	}
	const obj = value as Record<string, unknown>;
	const description = obj.description;
	const dockerfile = obj.dockerfile;
	const builtAt = obj.builtAt;
	const digest = obj.digest;
	if (typeof description !== "string") {
		throw new Error(`${label}.description must be a string`);
	}
	if (typeof dockerfile !== "string" || dockerfile.length === 0) {
		throw new Error(`${label}.dockerfile must be a non-empty string`);
	}
	if (typeof builtAt !== "string" || builtAt.length === 0) {
		throw new Error(`${label}.builtAt must be a non-empty string`);
	}
	if (typeof digest !== "string" || digest.length === 0) {
		throw new Error(`${label}.digest must be a non-empty string`);
	}
	return { name, description, dockerfile, builtAt, digest };
}

export async function loadPrototypeInitSkills(
	skillsDir: string,
	prototype: Prototype,
): Promise<Array<SkillContent>> {
	const skills: Array<SkillContent> = [];
	for (const skillName of prototype.skills) {
		const skillPath = join(skillsDir, `${skillName}.md`);
		let content = "";
		try {
			content = await readFile(skillPath, "utf-8");
		} catch {
			content = "";
		}
		skills.push({ name: skillName, content });
	}
	return skills;
}

export function defaultModelFromHostConfig(config: HostConfig): ModelConfig {
	if (config.models.anthropic !== null) {
		return {
			provider: "anthropic",
			name: "claude-sonnet-4",
			apiKey: config.models.anthropic.apiKey,
		};
	}
	if (config.models.openai !== null) {
		return {
			provider: "openai",
			name: "gpt-4o",
			apiKey: config.models.openai.apiKey,
		};
	}
	if (config.models.openrouter !== null) {
		return {
			provider: "openrouter",
			name: "anthropic/claude-sonnet-4",
			apiKey: config.models.openrouter.apiKey,
		};
	}
	return {
		provider: "anthropic",
		name: "claude-sonnet-4",
		apiKey: null,
	};
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

export function resolveModelConfig(
	hostConfig: HostConfig,
	requested: { provider: ModelConfig["provider"]; name: string } | null,
): ModelConfig {
	const base = requested ?? defaultModelFromHostConfig(hostConfig);
	const provider = base.provider;
	if (typeof provider === "string") {
		const known = provider as KnownProvider;
		const providerConfig = hostConfig.models[known];
		return {
			provider: known,
			name: base.name,
			apiKey: providerConfig?.apiKey ?? null,
		};
	}
	const custom = provider as CustomProvider;
	return {
		provider: custom,
		name: base.name,
		apiKey: null,
	};
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
		if (service === null || typeof service !== "object" || Array.isArray(service)) {
			continue;
		}
		const image = (service as Record<string, unknown>).image;
		if (typeof image === "string" && image.length > 0) {
			return image;
		}
	}
	return "unknown";
}

export function mergeSessionEnv(
	hostEnvFile: string,
	sessionEnv: Record<string, string> | null,
): Record<string, string> {
	const merged: Record<string, string> = {};
	if (sessionEnv !== null) {
		for (const [key, value] of Object.entries(sessionEnv)) {
			merged[key] = value;
		}
	}
	void hostEnvFile;
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
	const modelsRaw = obj.models;
	if (
		modelsRaw === null ||
		typeof modelsRaw !== "object" ||
		Array.isArray(modelsRaw)
	) {
		throw new Error(`Config ${path} field "models" must be a mapping`);
	}
	const modelsObj = modelsRaw as Record<string, unknown>;
	return {
		name,
		maxRunning,
		workspaceRoot,
		envFile,
		models: {
			anthropic: parseProviderConfig(
				modelsObj.anthropic,
				`${path} models.anthropic`,
			),
			openai: parseProviderConfig(modelsObj.openai, `${path} models.openai`),
			openrouter: parseProviderConfig(
				modelsObj.openrouter,
				`${path} models.openrouter`,
			),
		},
		resourceLimits: parseResourceLimits(obj.resourceLimits, path),
		defaults: parseHostDefaults(obj.defaults, path),
	};
}

function parseProviderConfig(
	value: unknown,
	label: string,
): { baseUrl: string | null; apiKey: string } | null {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be a mapping or null`);
	}
	const obj = value as Record<string, unknown>;
	const apiKey = obj.apiKey;
	if (typeof apiKey !== "string" || apiKey.length === 0) {
		throw new Error(`${label}.apiKey must be a non-empty string`);
	}
	const baseUrlRaw = obj.baseUrl;
	let baseUrl: string | null = null;
	if (baseUrlRaw !== undefined && baseUrlRaw !== null) {
		if (typeof baseUrlRaw !== "string" || baseUrlRaw.length === 0) {
			throw new Error(`${label}.baseUrl must be a non-empty string when set`);
		}
		baseUrl = baseUrlRaw;
	}
	return { baseUrl, apiKey };
}

function parseResourceLimits(
	value: unknown,
	path: string,
): HostConfig["resourceLimits"] {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Config ${path} field "resourceLimits" must be a mapping`);
	}
	const obj = value as Record<string, unknown>;
	const maxCpu = obj.maxCpu;
	const maxMemory = obj.maxMemory;
	if (typeof maxCpu !== "number" || !Number.isFinite(maxCpu)) {
		throw new Error(
			`Config ${path} field "resourceLimits.maxCpu" must be a finite number`,
		);
	}
	if (typeof maxMemory !== "string" || maxMemory.length === 0) {
		throw new Error(
			`Config ${path} field "resourceLimits.maxMemory" must be a non-empty string`,
		);
	}
	return { maxCpu, maxMemory };
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
	const timeout = obj.timeout;
	const maxTurns = obj.maxTurns;
	const resourcesRaw = obj.resources;
	if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
		throw new Error(
			`Config ${path} field "defaults.timeout" must be a finite number`,
		);
	}
	if (typeof maxTurns !== "number" || !Number.isFinite(maxTurns)) {
		throw new Error(
			`Config ${path} field "defaults.maxTurns" must be a finite number`,
		);
	}
	if (
		resourcesRaw === null ||
		typeof resourcesRaw !== "object" ||
		Array.isArray(resourcesRaw)
	) {
		throw new Error(
			`Config ${path} field "defaults.resources" must be a mapping`,
		);
	}
	const resourcesObj = resourcesRaw as Record<string, unknown>;
	const cpu = resourcesObj.cpu;
	const memory = resourcesObj.memory;
	if (typeof cpu !== "number" || !Number.isFinite(cpu)) {
		throw new Error(
			`Config ${path} field "defaults.resources.cpu" must be a finite number`,
		);
	}
	if (typeof memory !== "string" || memory.length === 0) {
		throw new Error(
			`Config ${path} field "defaults.resources.memory" must be a non-empty string`,
		);
	}
	return {
		timeout,
		maxTurns,
		resources: { cpu, memory },
	};
}

async function applyEnvFile(envFilePath: string): Promise<void> {
	const expanded = expandHome(envFilePath);
	let raw: string;
	try {
		raw = await readFile(expanded, "utf-8");
	} catch {
		return;
	}
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
