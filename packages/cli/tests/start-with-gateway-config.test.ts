/**
 * End-to-end CLI test for issue #32: a `sumeru.yaml` declaring
 * `gateways.claude-code.config.sendTimeoutMs` results in the claude-code
 * adapter using that timeout for `send`. Booted via `loadConfig` +
 * `buildAdapters` (the same pipeline the `sumeru start` command uses).
 *
 * The adapter factory is intercepted via the injectable factory map so we can
 * inspect the options object the parsed YAML produced — no real subprocess.
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
	const caps: AdapterCapabilities = { resume: true, streaming: false };
	return {
		name,
		capabilities: caps,
		createSession: async () => ({ nativeId: "x", meta: {} }),
		send: async () => ({ turns: [], tokens: null, durationMs: 0 }),
		close: async () => {},
		getTurns: async () => [],
	};
}

describe("CLI start with gateway config (issue #32)", () => {
	it("forwards parsed YAML config to the claude-code factory", async () => {
		const dir = fixtureDir();
		const yamlPath = join(dir, "sumeru.yaml");
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
		const captured: Array<{ adapter: string; opts: Record<string, unknown> }> =
			[];
		const factories: AdapterFactoryMap = {
			"claude-code": (opts) => {
				captured.push({ adapter: "claude-code", opts });
				return fakeAdapter("claude-code");
			},
		};
		const adapters = buildAdapters(cfg.gateways, factories);
		expect(Object.keys(adapters)).toEqual(["claude-code"]);
		expect(captured).toEqual([
			{
				adapter: "claude-code",
				opts: {
					sendTimeoutMs: 1_800_000,
					createSessionTimeoutMs: 300_000,
					maxTurns: 120,
				},
			},
		]);
	});

	it("two gateways using the same adapter type get independent option blobs", async () => {
		const dir = fixtureDir();
		const yamlPath = join(dir, "sumeru.yaml");
		writeFileSync(
			yamlPath,
			[
				"name: sumeru@neko",
				"gateways:",
				"  cc-fast:",
				"    adapter: claude-code",
				"    config:",
				"      sendTimeoutMs: 60000",
				"    capabilities:",
				"      resume: true",
				"      streaming: false",
				"  cc-slow:",
				"    adapter: claude-code",
				"    config:",
				"      sendTimeoutMs: 1800000",
				"    capabilities:",
				"      resume: true",
				"      streaming: false",
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
		const adapters = buildAdapters(cfg.gateways, factories);
		expect(Object.keys(adapters).sort()).toEqual(["cc-fast", "cc-slow"]);
		expect(captured).toEqual([
			{ sendTimeoutMs: 60_000 },
			{ sendTimeoutMs: 1_800_000 },
		]);
		expect(adapters["cc-fast"]).not.toBe(adapters["cc-slow"]);
	});

	it("no-config YAML is byte-identical to today (factories called with `{}`)", async () => {
		const dir = fixtureDir();
		const yamlPath = join(dir, "sumeru.yaml");
		writeFileSync(
			yamlPath,
			[
				"name: sumeru@plain",
				"gateways:",
				"  hermes:",
				"    adapter: hermes",
				"    capabilities:",
				"      resume: true",
				"      streaming: true",
				"",
			].join("\n"),
			"utf-8",
		);
		const cfg = await loadConfig(yamlPath);
		const captured: Array<Record<string, unknown>> = [];
		const factories: AdapterFactoryMap = {
			hermes: (opts) => {
				captured.push(opts);
				return fakeAdapter("hermes");
			},
		};
		buildAdapters(cfg.gateways, factories);
		expect(captured).toEqual([{}]);
	});
});
