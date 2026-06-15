/**
 * End-to-end test: `sumeru start --config <fixture>` parses a YAML with the
 * exact "Proposed" shape from issue #32 and the claude-code adapter sees the
 * configured timeouts.
 *
 * Booted via `loadConfig` + `buildAdapters` (the same pipeline `sumeru start`
 * uses). The adapter factory is intercepted to capture the options blob.
 *
 * See `specs/adapter-claude-code-timeout-config.md`.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Adapter, AdapterCapabilities } from "@sumeru/core";
import { loadConfig } from "@sumeru/server";
import { describe, expect, it } from "vitest";
import {
	type AdapterFactoryMap,
	buildAdapters,
} from "../src/build-adapters.js";

function fixtureDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-cli-fixture-"));
}

function fakeAdapter(name: string): Adapter {
	const caps: AdapterCapabilities = { resume: true, streaming: true };
	return {
		name,
		capabilities: caps,
		createSession: async () => ({ nativeId: "x", meta: {} }),
		send: async () => ({ turns: [], tokens: null, durationMs: 0 }),
		close: async () => {},
		getTurns: async () => [],
	};
}

describe("CLI start with claude-code timeout config (issue #32)", () => {
	it("parses the issue's 'Proposed' YAML shape end-to-end", async () => {
		const dir = fixtureDir();
		const yamlPath = join(dir, "sumeru.cc-timeout.yaml");
		writeFileSync(
			yamlPath,
			[
				"name: sumeru@neko",
				"gateways:",
				"  claude-code:",
				"    adapter: claude-code",
				"    config:",
				"      sendTimeoutMs: 1800000",
				"      createSessionTimeoutMs: 300000",
				"      maxTurns: 120",
				"    capabilities:",
				"      resume: true",
				"      streaming: true",
				"",
			].join("\n"),
			"utf-8",
		);

		const cfg = await loadConfig(yamlPath);
		const captured: Record<string, unknown>[] = [];
		const factories: AdapterFactoryMap = {
			"claude-code": (opts) => {
				captured.push(opts);
				return fakeAdapter("claude-code");
			},
		};
		buildAdapters(cfg.gateways, factories);
		expect(captured).toEqual([
			{
				sendTimeoutMs: 1_800_000,
				createSessionTimeoutMs: 300_000,
				maxTurns: 120,
			},
		]);
	});
});
