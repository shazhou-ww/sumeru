import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HarnessConfig } from "./harness/types.js";

export type ControlFrameType = "reset" | "model" | "install-skill";

export type ModelControlValue = {
	baseUrl: string;
	apiKey: string | null;
	model: string;
	provider: string | null;
};

export type InstallSkillControlValue = {
	name: string;
	content: string;
	files: Array<{ path: string; content: string }>;
};

export type ResetControlValue = {
	persona: string | null;
};

const CONTROL_FRAME_TYPES = new Set<ControlFrameType>([
	"reset",
	"model",
	"install-skill",
]);

export function isControlFrameType(type: string): type is ControlFrameType {
	return CONTROL_FRAME_TYPES.has(type as ControlFrameType);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseResetValue(value: unknown): ResetControlValue {
	if (!isRecord(value)) {
		return { persona: null };
	}
	const persona = value.persona;
	if (typeof persona === "string") {
		return { persona };
	}
	return { persona: null };
}

function parseModelValue(value: unknown): ModelControlValue | null {
	if (!isRecord(value)) return null;
	if (typeof value.baseUrl !== "string") return null;
	if (typeof value.model !== "string") return null;
	const apiKey = value.apiKey;
	if (apiKey !== null && typeof apiKey !== "string") return null;
	const provider = value.provider;
	if (
		provider !== null &&
		provider !== undefined &&
		typeof provider !== "string"
	) {
		return null;
	}
	return {
		baseUrl: value.baseUrl,
		apiKey: apiKey as string | null,
		model: value.model,
		provider: typeof provider === "string" ? provider : null,
	};
}

function parseInstallSkillValue(
	value: unknown,
): InstallSkillControlValue | null {
	if (!isRecord(value)) return null;
	if (typeof value.name !== "string") return null;
	if (typeof value.content !== "string") return null;
	const filesRaw = value.files;
	const files: Array<{ path: string; content: string }> = [];
	if (filesRaw !== undefined) {
		if (!Array.isArray(filesRaw)) return null;
		for (const entry of filesRaw) {
			if (!isRecord(entry)) return null;
			if (typeof entry.path !== "string") return null;
			if (typeof entry.content !== "string") return null;
			files.push({ path: entry.path, content: entry.content });
		}
	}
	return { name: value.name, content: value.content, files };
}

async function resetHarnessState(
	harness: HarnessConfig,
	persona: string | null,
): Promise<void> {
	for (const path of harness.resetPaths) {
		await rm(path, { recursive: true, force: true });
	}
	if (persona !== null && harness.personaPath !== null) {
		await writeFile(harness.personaPath, persona, "utf8");
	}
}

async function writeDefaultModelConfig(
	harness: HarnessConfig,
	value: ModelControlValue,
): Promise<void> {
	if (harness.modelConfigPath === null) {
		return;
	}
	const payload = {
		baseUrl: value.baseUrl,
		apiKey: value.apiKey,
		model: value.model,
		provider: value.provider,
	};
	await writeFile(
		harness.modelConfigPath,
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);
}

async function writeModelConfig(
	harness: HarnessConfig,
	value: ModelControlValue,
): Promise<void> {
	if (harness.writeModelConfig !== null) {
		await harness.writeModelConfig(value);
		return;
	}
	await writeDefaultModelConfig(harness, value);
}

async function installDefaultSkill(
	harness: HarnessConfig,
	value: InstallSkillControlValue,
): Promise<void> {
	if (harness.skillsDir === null) {
		return;
	}
	const skillDir = join(harness.skillsDir, value.name);
	await mkdir(skillDir, { recursive: true });
	await writeFile(join(skillDir, "SKILL.md"), value.content, "utf8");
	for (const file of value.files) {
		const filePath = join(skillDir, file.path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content, "utf8");
	}
}

async function installSkill(
	harness: HarnessConfig,
	value: InstallSkillControlValue,
): Promise<void> {
	if (harness.installSkill !== null) {
		await harness.installSkill(value);
		return;
	}
	await installDefaultSkill(harness, value);
}

export async function handleControlFrame(
	harness: HarnessConfig,
	frame: Record<string, unknown>,
): Promise<void> {
	const type = frame.type;
	if (typeof type !== "string" || !isControlFrameType(type)) {
		throw new Error(`unsupported control frame: ${String(type)}`);
	}

	switch (type) {
		case "reset": {
			const resetValue = parseResetValue(frame.value);
			await resetHarnessState(harness, resetValue.persona);
			return;
		}
		case "model": {
			const modelValue = parseModelValue(frame.value);
			if (modelValue === null) {
				throw new Error("invalid model control frame value");
			}
			await writeModelConfig(harness, modelValue);
			return;
		}
		case "install-skill": {
			const skillValue = parseInstallSkillValue(frame.value);
			if (skillValue === null) {
				throw new Error("invalid install-skill control frame value");
			}
			await installSkill(harness, skillValue);
			return;
		}
	}
}
