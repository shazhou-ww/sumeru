import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelControlValue } from "../control-frames.js";
import type { HarnessConfig } from "./types.js";

function normalizeAnthropicBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/v1\/?$/, "");
}

export function formatClaudeCodeModelConfig(value: ModelControlValue): string {
	const lines = [
		`ANTHROPIC_BASE_URL=${normalizeAnthropicBaseUrl(value.baseUrl)}`,
	];
	if (value.apiKey !== null) {
		lines.push(`ANTHROPIC_API_KEY=${value.apiKey}`);
	}
	lines.push(`CLAUDE_MODEL=${value.model}`);
	return `${lines.join("\n")}\n`;
}

async function writeClaudeCodeModelConfig(
	modelConfigPath: string,
	value: ModelControlValue,
): Promise<void> {
	await mkdir(dirname(modelConfigPath), { recursive: true });
	await writeFile(modelConfigPath, formatClaudeCodeModelConfig(value), "utf8");
}

const claudeDir = join(homedir(), ".claude");

export const claudeCodeHarness: HarnessConfig = {
	resetPaths: [join(claudeDir, "projects")],
	modelConfigPath: join(claudeDir, ".env"),
	personaPath: join(claudeDir, "CLAUDE.md"),
	skillsDir: join(claudeDir, "skills"),
	writeModelConfig: async (value) => {
		if (claudeCodeHarness.modelConfigPath === null) {
			return;
		}
		await writeClaudeCodeModelConfig(claudeCodeHarness.modelConfigPath, value);
	},
	installSkill: null,
};
