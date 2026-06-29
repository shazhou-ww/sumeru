import { createHash } from "node:crypto";
import {
	access,
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Prototype } from "@sumeru/core";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { PrototypeInfo } from "./types.js";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

export function validateResourceName(name: string, label: string): void {
	if (!NAME_PATTERN.test(name)) {
		throw new Error(
			`${label} must match ${NAME_PATTERN.source} (got ${JSON.stringify(name)})`,
		);
	}
}

export async function ensureDataDirs(
	skillsDir: string,
	prototypesDir: string,
): Promise<void> {
	await mkdir(skillsDir, { recursive: true });
	await mkdir(prototypesDir, { recursive: true });
}

export async function listSkillNames(
	skillsDir: string,
): Promise<Array<string>> {
	try {
		const entries = await readdir(skillsDir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name.slice(0, -".md".length))
			.sort();
	} catch {
		return [];
	}
}

export async function skillExists(
	skillsDir: string,
	name: string,
): Promise<boolean> {
	try {
		await access(skillPath(skillsDir, name));
		return true;
	} catch {
		return false;
	}
}

export async function readSkill(
	skillsDir: string,
	name: string,
): Promise<string> {
	validateResourceName(name, "skill name");
	return readFile(skillPath(skillsDir, name), "utf-8");
}

export async function writeSkill(
	skillsDir: string,
	name: string,
	content: string,
): Promise<void> {
	validateResourceName(name, "skill name");
	await mkdir(skillsDir, { recursive: true });
	const target = skillPath(skillsDir, name);
	const temp = `${target}.tmp`;
	await writeFile(temp, content, "utf-8");
	await rename(temp, target);
}

export async function deleteSkill(
	skillsDir: string,
	name: string,
): Promise<void> {
	validateResourceName(name, "skill name");
	await unlink(skillPath(skillsDir, name));
}

function skillPath(skillsDir: string, name: string): string {
	return join(skillsDir, `${name}.md`);
}

export async function findPrototypeReferencesToSkill(
	prototypesDir: string,
	skillName: string,
): Promise<Array<string>> {
	const names = await listPrototypeFileNames(prototypesDir);
	const references: Array<string> = [];
	for (const name of names) {
		const prototype = await readPrototypeFile(prototypesDir, name);
		if (prototype.skills.includes(skillName)) {
			references.push(name);
		}
	}
	return references;
}

export async function listPrototypeFileNames(
	prototypesDir: string,
): Promise<Array<string>> {
	try {
		const entries = await readdir(prototypesDir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
			.map((entry) => entry.name.slice(0, -".yaml".length))
			.sort();
	} catch {
		return [];
	}
}

export async function readPrototypeFile(
	prototypesDir: string,
	name: string,
): Promise<Prototype> {
	validateResourceName(name, "prototype name");
	const yamlPath = prototypePath(prototypesDir, name);
	const raw = await readFile(yamlPath, "utf-8");
	const doc = parseYamlSafely(raw, yamlPath);
	return validatePrototype(doc, yamlPath, name);
}

export async function writePrototypeFile(
	prototypesDir: string,
	prototype: Prototype,
): Promise<void> {
	validateResourceName(prototype.name, "prototype name");
	await mkdir(prototypesDir, { recursive: true });
	const yamlPath = prototypePath(prototypesDir, prototype.name);
	const temp = `${yamlPath}.tmp`;
	await writeFile(temp, stringifyYaml(prototype), "utf-8");
	await rename(temp, yamlPath);
}

export async function deletePrototypeFile(
	prototypesDir: string,
	name: string,
): Promise<void> {
	validateResourceName(name, "prototype name");
	await unlink(prototypePath(prototypesDir, name));
}

export async function prototypeFileExists(
	prototypesDir: string,
	name: string,
): Promise<boolean> {
	try {
		await access(prototypePath(prototypesDir, name));
		return true;
	} catch {
		return false;
	}
}

export async function assertSkillsExist(
	skillsDir: string,
	skillNames: Array<string>,
): Promise<Array<string>> {
	const missing: Array<string> = [];
	for (const skillName of skillNames) {
		if (!(await skillExists(skillsDir, skillName))) {
			missing.push(skillName);
		}
	}
	return missing;
}

export async function loadPrototypesFromDisk(input: {
	rootDir: string;
	prototypesDir: string;
	skillsDir: string;
}): Promise<Map<string, PrototypeInfo>> {
	const names = await listPrototypeFileNames(input.prototypesDir);
	const prototypes = new Map<string, PrototypeInfo>();
	for (const name of names) {
		const info = await loadPrototypeInfo(input, name);
		prototypes.set(name, info);
	}
	return prototypes;
}

export async function loadPrototypeInfo(
	input: { rootDir: string; prototypesDir: string; skillsDir: string },
	name: string,
): Promise<PrototypeInfo> {
	const yamlPath = prototypePath(input.prototypesDir, name);
	const prototype = await readPrototypeFile(input.prototypesDir, name);
	const prototypeHash = await computePrototypeHash(
		yamlPath,
		input.skillsDir,
		prototype,
	);
	const composePath = await resolveLegacyComposePath(input.rootDir, name);
	return { name, prototype, yamlPath, prototypeHash, composePath };
}

async function resolveLegacyComposePath(
	rootDir: string,
	name: string,
): Promise<string | null> {
	const composePath = join(rootDir, "prototypes", name, "compose.yaml");
	try {
		await access(composePath);
		return composePath;
	} catch {
		return null;
	}
}

export async function computePrototypeHash(
	yamlPath: string,
	skillsDir: string,
	prototype: Prototype,
): Promise<string> {
	const hash = createHash("sha256");
	const yamlRaw = await readFile(yamlPath, "utf-8");
	hash.update("prototype\0");
	hash.update(yamlRaw);
	const skillNames = [...prototype.skills].sort();
	for (const skillName of skillNames) {
		const skillFile = skillPath(skillsDir, skillName);
		try {
			const content = await readFile(skillFile);
			hash.update(`skill:${skillName}\0`);
			hash.update(content);
		} catch {
			hash.update(`skill:${skillName}\0`);
		}
	}
	return hash.digest("hex");
}

function prototypePath(prototypesDir: string, name: string): string {
	return join(prototypesDir, `${name}.yaml`);
}

export function validatePrototype(
	doc: unknown,
	path: string,
	expectedName: string,
): Prototype {
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(
			`Prototype ${path} must be a YAML mapping at the top level`,
		);
	}
	const obj = doc as Record<string, unknown>;
	const name = obj.name;
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(
			`Prototype ${path} is missing required field "name" (must be a non-empty string)`,
		);
	}
	if (name !== expectedName) {
		throw new Error(
			`Prototype ${path} field "name" (${JSON.stringify(name)}) must match file name ${JSON.stringify(expectedName)}`,
		);
	}
	const instructions = obj.instructions;
	if (typeof instructions !== "string") {
		throw new Error(`Prototype ${path} field "instructions" must be a string`);
	}
	const skillsRaw = obj.skills;
	const skills: Array<string> = [];
	if (skillsRaw !== undefined && skillsRaw !== null) {
		if (!Array.isArray(skillsRaw)) {
			throw new Error(`Prototype ${path} field "skills" must be an array`);
		}
		for (const item of skillsRaw) {
			if (typeof item !== "string") {
				throw new Error(
					`Prototype ${path} field "skills" must contain only strings`,
				);
			}
			skills.push(item);
		}
	}
	const defaults = parsePrototypeDefaults(obj.defaults, path);
	return { name, instructions, skills, defaults };
}

function parsePrototypeDefaults(
	value: unknown,
	path: string,
): Prototype["defaults"] {
	if (value === undefined || value === null) {
		return null;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`Prototype ${path} field "defaults" must be a mapping`);
	}
	const obj = value as Record<string, unknown>;
	const maxTurns = obj.maxTurns;
	const timeout = obj.timeout;
	const resourcesRaw = obj.resources;
	if (typeof maxTurns !== "number" || !Number.isFinite(maxTurns)) {
		throw new Error(
			`Prototype ${path} field "defaults.maxTurns" must be a finite number`,
		);
	}
	if (typeof timeout !== "number" || !Number.isFinite(timeout)) {
		throw new Error(
			`Prototype ${path} field "defaults.timeout" must be a finite number`,
		);
	}
	if (
		resourcesRaw === null ||
		typeof resourcesRaw !== "object" ||
		Array.isArray(resourcesRaw)
	) {
		throw new Error(
			`Prototype ${path} field "defaults.resources" must be a mapping`,
		);
	}
	const resourcesObj = resourcesRaw as Record<string, unknown>;
	const cpu = resourcesObj.cpu;
	const memory = resourcesObj.memory;
	if (typeof cpu !== "number" || !Number.isFinite(cpu)) {
		throw new Error(
			`Prototype ${path} field "defaults.resources.cpu" must be a finite number`,
		);
	}
	if (typeof memory !== "string" || memory.length === 0) {
		throw new Error(
			`Prototype ${path} field "defaults.resources.memory" must be a non-empty string`,
		);
	}
	return {
		maxTurns,
		timeout,
		resources: { cpu, memory },
	};
}

function parseYamlSafely(raw: string, path: string): unknown {
	try {
		return parseYaml(raw);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`Invalid YAML in ${path}: ${msg}`);
	}
}
