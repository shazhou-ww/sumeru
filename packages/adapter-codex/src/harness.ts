import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HarnessConfig, ModelControlValue } from "@sumeru/adapter-core";

const DEFAULT_PROVIDER_ID = "bridge";
const DEFAULT_PROVIDER_NAME = "Copilot Bridge";

function tomlString(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function formatCodexModelConfig(value: ModelControlValue): string {
	const rawProviderId = value.provider ?? DEFAULT_PROVIDER_ID;
	// Codex CLI doesn't allow overriding built-in providers (openai, anthropic)
	// Add "-custom" suffix if provider ID conflicts with built-ins
	const RESERVED_PROVIDER_IDS = new Set(["openai", "anthropic"]);
	const providerId = RESERVED_PROVIDER_IDS.has(rawProviderId)
		? `${rawProviderId}-custom`
		: rawProviderId;
	const providerName =
		rawProviderId === DEFAULT_PROVIDER_ID
			? DEFAULT_PROVIDER_NAME
			: rawProviderId;
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
const adapterStateDir = join(homedir(), ".codex-adapter");

export const codexHarness: HarnessConfig = {
	resetPaths: [join(codexDir, "sessions"), adapterStateDir],
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
