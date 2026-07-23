import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { HarnessConfig, ModelControlValue } from "@sumeru/adapter-core";

const KNOWN_PROVIDERS = new Set(["anthropic", "openai", "openrouter"]);
const DEFAULT_CUSTOM_PROVIDER_NAME = "bridge";

function yamlScalar(value: string): string {
	if (/[:#\n"'\\]|^\s|\s$/.test(value)) {
		return JSON.stringify(value);
	}
	return value;
}

function appendApiKey(
	lines: Array<string>,
	indent: string,
	apiKey: string | null,
): void {
	if (apiKey !== null) {
		lines.push(`${indent}api_key: ${yamlScalar(apiKey)}`);
	}
}

function inferKnownProvider(baseUrl: string): string | null {
	if (baseUrl.includes("api.anthropic.com")) {
		return "anthropic";
	}
	if (baseUrl.includes("api.openai.com")) {
		return "openai";
	}
	if (baseUrl.includes("openrouter.ai")) {
		return "openrouter";
	}
	return null;
}

function resolveKnownProvider(value: ModelControlValue): string | null {
	if (value.provider !== null && KNOWN_PROVIDERS.has(value.provider)) {
		return value.provider;
	}
	return inferKnownProvider(value.baseUrl);
}

function resolveCustomProviderName(value: ModelControlValue): string {
	if (value.provider !== null && !KNOWN_PROVIDERS.has(value.provider)) {
		return value.provider;
	}
	return DEFAULT_CUSTOM_PROVIDER_NAME;
}

function normalizeCustomBaseUrl(baseUrl: string): string {
	if (baseUrl.endsWith("/v1") || baseUrl.endsWith("/v1/")) {
		return baseUrl;
	}
	return `${baseUrl.replace(/\/$/, "")}/v1`;
}

export function formatHermesModelConfig(value: ModelControlValue): string {
	const knownProvider = resolveKnownProvider(value);
	if (knownProvider !== null) {
		const lines = ["model:"];
		lines.push(`  provider: ${yamlScalar(knownProvider)}`);
		lines.push(`  default: ${yamlScalar(value.model)}`);
		appendApiKey(lines, "  ", value.apiKey);
		return `${lines.join("\n")}\n`;
	}

	const customName = resolveCustomProviderName(value);
	const baseUrl = normalizeCustomBaseUrl(value.baseUrl);
	const lines = [
		"custom_providers:",
		`  - name: ${yamlScalar(customName)}`,
		`    base_url: ${yamlScalar(baseUrl)}`,
		"    api_mode: chat_completions",
	];
	appendApiKey(lines, "    ", value.apiKey);
	lines.push("model:");
	lines.push(`  provider: custom:${yamlScalar(customName)}`);
	lines.push(`  default: ${yamlScalar(value.model)}`);
	return `${lines.join("\n")}\n`;
}

async function writeHermesModelConfig(
	modelConfigPath: string,
	value: ModelControlValue,
): Promise<void> {
	await mkdir(dirname(modelConfigPath), { recursive: true });
	await writeFile(modelConfigPath, formatHermesModelConfig(value), "utf8");
}

const hermesDir = join(homedir(), ".hermes");
const adapterDir = join(homedir(), ".hermes-adapter");

export const hermesHarness: HarnessConfig = {
	resetPaths: [
		join(hermesDir, "sessions"),
		join(hermesDir, "state.db"),
		join(hermesDir, "state.db-wal"),
		join(hermesDir, "state.db-shm"),
		join(adapterDir, "session.json"),
	],
	modelConfigPath: join(hermesDir, "config.yaml"),
	personaPath: join(hermesDir, "SOUL.md"),
	skillsDir: join(hermesDir, "skills"),
	writeModelConfig: async (value) => {
		if (hermesHarness.modelConfigPath === null) {
			return;
		}
		await writeHermesModelConfig(hermesHarness.modelConfigPath, value);
	},
	installSkill: null,
};
