import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelControlValue } from "../control-frames.js";
import type { HarnessConfig } from "./types.js";

const DEFAULT_PROVIDER_ID = "bridge";
const DEFAULT_PROVIDER_NAME = "Copilot Bridge";

function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatCodexModelConfig(value: ModelControlValue): string {
	const providerId = value.provider ?? DEFAULT_PROVIDER_ID;
	const providerName =
		providerId === DEFAULT_PROVIDER_ID ? DEFAULT_PROVIDER_NAME : providerId;
	const lines = [
		`model = ${tomlString(value.model)}`,
		`model_provider = ${tomlString(providerId)}`,
		"",
		`[model_providers.${providerId}]`,
		`name = ${tomlString(providerName)}`,
		`base_url = ${tomlString(value.baseUrl)}`,
		`wire_api = "responses"`,
		`requires_openai_auth = false`,
	];
	if (value.apiKey !== null) {
		lines.push(`api_key = ${tomlString(value.apiKey)}`);
	}
	return `${lines.join("\n")}\n`;
}

async function writeCodexModelConfig(
	modelConfigPath: string,
	value: ModelControlValue,
): Promise<void> {
	await mkdir(dirname(modelConfigPath), { recursive: true });
	await writeFile(modelConfigPath, formatCodexModelConfig(value), "utf8");
}

const codexDir = join(homedir(), ".codex");

export const codexHarness: HarnessConfig = {
	resetPaths: [join(codexDir, "sessions")],
	modelConfigPath: join(codexDir, "config.toml"),
	personaPath: join(codexDir, "instructions.md"),
	skillsDir: join(codexDir, "skills"),
	writeModelConfig: async (value) => {
		if (codexHarness.modelConfigPath === null) {
			return;
		}
		await writeCodexModelConfig(codexHarness.modelConfigPath, value);
	},
	installSkill: null,
};
