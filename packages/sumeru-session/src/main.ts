#!/usr/bin/env node
import type { AdapterImpl } from "@sumeru/adapter-core";
import { createAdapterEntry } from "@sumeru/adapter-core";
import { type DetectedAdapter, detectAdapter } from "./detect.js";

function resolveHermesProfile(): string {
	const profile = process.env.SUMERU_HERMES_PROFILE;
	if (typeof profile === "string" && profile.length > 0) {
		return profile;
	}
	return "default";
}

async function loadAdapterImpl(kind: DetectedAdapter): Promise<AdapterImpl> {
	switch (kind) {
		case "codex": {
			const { createCodexAdapter } = await import("@sumeru/adapter-codex");
			return createCodexAdapter();
		}
		case "hermes": {
			const { createHermesAdapter } = await import("@sumeru/adapter-hermes");
			return createHermesAdapter({ profile: resolveHermesProfile() });
		}
		case "claude-code": {
			const { createClaudeCodeAdapter } = await import(
				"@sumeru/adapter-claude-code"
			);
			return createClaudeCodeAdapter();
		}
		case "cursor-agent": {
			const { createCursorAgentAdapter } = await import(
				"@sumeru/adapter-cursor-agent"
			);
			return createCursorAgentAdapter();
		}
		case "sarsapa": {
			const { createSarsapaAdapter } = await import("@sumeru/sarsapa");
			return createSarsapaAdapter();
		}
	}
}

async function main(): Promise<void> {
	const kind = detectAdapter();
	const impl = await loadAdapterImpl(kind);
	createAdapterEntry(impl);
}

void main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stdout.write(
		`${JSON.stringify({
			type: "error",
			value: { code: "fatal_error", message },
		})}\n`,
	);
	process.exit(1);
});
