import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SkillContent } from "@sumeru/adapter-core";
import type { HostConfig, Manifest, ModelConfig } from "@sumeru/core";
import { parse as parseYaml } from "yaml";
import type { LoadedHostConfig, PrototypeInfo } from "./types.js";

const DEFAULT_HOST_FILE = "host.yaml";
const DEFAULT_PROTOTYPES_DIR = "prototypes";

export async function loadHostConfig(
	rootDir: string,
): Promise<LoadedHostConfig> {
	const configPath = join(rootDir, DEFAULT_HOST_FILE);
	const prototypesDir = join(rootDir, DEFAULT_PROTOTYPES_DIR);
	const config = await loadHostYaml(configPath);
	const prototypes = await scanPrototypes(prototypesDir);
	return {
		rootDir,
		configPath,
		prototypesDir,
		config,
		prototypes,
	};
}

async function loadHostYaml(configPath: string): Promise<HostConfig> {
	const raw = await readFileSafely(configPath);
	const doc = parseYamlSafely(raw, configPath);
	return validateHostConfig(doc, configPath);
}

async function scanPrototypes(
	prototypesDir: string,
): Promise<Map<string, PrototypeInfo>> {
	const entries = await readdir(prototypesDir, { withFileTypes: true });
	const prototypes = new Map<string, PrototypeInfo>();
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const prototypeDir = join(prototypesDir, entry.name);
		const manifestPath = join(prototypeDir, "manifest.yaml");
		const composePath = join(prototypeDir, "compose.yaml");
		const manifest = await loadManifest(manifestPath);
		const adapter = resolveAdapterName(manifest.name, entry.name);
		prototypes.set(entry.name, {
			name: entry.name,
			adapter,
			manifest,
			composePath,
			manifestPath,
		});
	}
	return prototypes;
}

async function loadManifest(manifestPath: string): Promise<Manifest> {
	const raw = await readFileSafely(manifestPath);
	const doc = parseYamlSafely(raw, manifestPath);
	return validateManifest(doc, manifestPath);
}

export async function loadPrototypeInitSkills(
	prototypeDir: string,
	manifest: Manifest,
): Promise<Array<SkillContent>> {
	const skills: Array<SkillContent> = [];
	for (const skillName of manifest.skills) {
		const skillPath = join(prototypeDir, "skills", skillName, "SKILL.md");
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

function resolveAdapterName(manifestName: string, dirName: string): string {
	if (manifestName.length > 0) return manifestName;
	return dirName;
}

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
	const masterRaw = obj.master;
	if (
		masterRaw === null ||
		typeof masterRaw !== "object" ||
		Array.isArray(masterRaw)
	) {
		throw new Error(`Config ${path} field "master" must be a mapping`);
	}
	const masterObj = masterRaw as Record<string, unknown>;
	const adapter = masterObj.adapter;
	if (typeof adapter !== "string" || adapter.length === 0) {
		throw new Error(
			`Config ${path} field "master.adapter" must be a non-empty string`,
		);
	}
	const masterConfig =
		masterObj.config === null || masterObj.config === undefined
			? {}
			: validateRecord(masterObj.config, `${path} field "master.config"`);
	const resourcesRaw = obj.resources;
	if (
		resourcesRaw === null ||
		typeof resourcesRaw !== "object" ||
		Array.isArray(resourcesRaw)
	) {
		throw new Error(`Config ${path} field "resources" must be a mapping`);
	}
	const resourcesObj = resourcesRaw as Record<string, unknown>;
	const maxMemory = resourcesObj.maxMemory;
	const maxCpus = resourcesObj.maxCpus;
	const maxInstances = resourcesObj.maxInstances;
	if (typeof maxMemory !== "string" || maxMemory.length === 0) {
		throw new Error(
			`Config ${path} field "resources.maxMemory" must be a non-empty string`,
		);
	}
	if (typeof maxCpus !== "number" || !Number.isFinite(maxCpus)) {
		throw new Error(
			`Config ${path} field "resources.maxCpus" must be a finite number`,
		);
	}
	if (typeof maxInstances !== "number" || !Number.isFinite(maxInstances)) {
		throw new Error(
			`Config ${path} field "resources.maxInstances" must be a finite number`,
		);
	}
	return {
		name,
		master: { adapter, config: masterConfig },
		resources: {
			maxMemory,
			maxCpus,
			maxInstances,
		},
	};
}

function validateManifest(doc: unknown, path: string): Manifest {
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(`Manifest ${path} must be a YAML mapping at the top level`);
	}
	const obj = doc as Record<string, unknown>;
	const name = obj.name;
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(
			`Manifest ${path} is missing required field "name" (must be a non-empty string)`,
		);
	}
	const instructions = obj.instructions;
	if (typeof instructions !== "string") {
		throw new Error(`Manifest ${path} field "instructions" must be a string`);
	}
	const skillsRaw = obj.skills;
	const skills: Array<string> = [];
	if (skillsRaw !== undefined && skillsRaw !== null) {
		if (!Array.isArray(skillsRaw)) {
			throw new Error(`Manifest ${path} field "skills" must be an array`);
		}
		for (const item of skillsRaw) {
			if (typeof item !== "string") {
				throw new Error(
					`Manifest ${path} field "skills" must contain only strings`,
				);
			}
			skills.push(item);
		}
	}
	const modelRaw = obj.model;
	if (
		modelRaw === null ||
		typeof modelRaw !== "object" ||
		Array.isArray(modelRaw)
	) {
		throw new Error(`Manifest ${path} field "model" must be a mapping`);
	}
	return {
		name,
		instructions,
		skills,
		model: validateModelConfig(modelRaw as Record<string, unknown>, path),
	};
}

function validateModelConfig(
	obj: Record<string, unknown>,
	path: string,
): ModelConfig {
	const provider = obj.provider;
	const name = obj.name;
	const apiKeyEnv = obj.apiKeyEnv;
	const contextWindow = obj.contextWindow;
	if (
		provider !== "anthropic" &&
		provider !== "openai" &&
		provider !== "openrouter" &&
		(typeof provider !== "object" ||
			provider === null ||
			Array.isArray(provider))
	) {
		throw new Error(
			`Manifest ${path} field "model.provider" must be a known provider or custom mapping`,
		);
	}
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(
			`Manifest ${path} field "model.name" must be a non-empty string`,
		);
	}
	if (typeof apiKeyEnv !== "string" || apiKeyEnv.length === 0) {
		throw new Error(
			`Manifest ${path} field "model.apiKeyEnv" must be a non-empty string`,
		);
	}
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow)) {
		throw new Error(
			`Manifest ${path} field "model.contextWindow" must be a finite number`,
		);
	}
	if (
		provider === "anthropic" ||
		provider === "openai" ||
		provider === "openrouter"
	) {
		return { provider, name, apiKeyEnv, contextWindow };
	}
	const custom = provider as Record<string, unknown>;
	const baseUrl = custom.baseUrl;
	const apiType = custom.apiType;
	if (typeof baseUrl !== "string" || baseUrl.length === 0) {
		throw new Error(
			`Manifest ${path} custom provider requires "baseUrl" string`,
		);
	}
	if (apiType !== "openai" && apiType !== "anthropic") {
		throw new Error(
			`Manifest ${path} custom provider requires apiType "openai" | "anthropic"`,
		);
	}
	return {
		provider: { baseUrl, apiType },
		name,
		apiKeyEnv,
		contextWindow,
	};
}

function validateRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
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
