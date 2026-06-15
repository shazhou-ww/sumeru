import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

function fixturePath(name: string): string {
	const url = new URL(`./fixtures/${name}`, import.meta.url);
	return fileURLToPath(url);
}

describe("loadConfig — gateway config blob (issue #32)", () => {
	it("parses a populated `config:` block verbatim onto the gateway entry", async () => {
		const cfg = await loadConfig(
			fixturePath("sumeru.gateway-with-config.yaml"),
		);
		expect(cfg).toEqual({
			name: "sumeru@neko",
			workspaceRoot: null,
			gateways: {
				"claude-code": {
					adapter: "claude-code",
					capabilities: { resume: true, streaming: true },
					config: {
						sendTimeoutMs: 1800000,
						createSessionTimeoutMs: 300000,
						maxTurns: 120,
					},
				},
			},
		});
	});

	it("preserves YAML mapping order inside `config`", async () => {
		const cfg = await loadConfig(
			fixturePath("sumeru.gateway-with-config.yaml"),
		);
		const blob = cfg.gateways["claude-code"]?.config;
		expect(blob).not.toBeNull();
		expect(Object.keys(blob as Record<string, unknown>)).toEqual([
			"sendTimeoutMs",
			"createSessionTimeoutMs",
			"maxTurns",
		]);
	});

	it("yields an empty object when `config: {}` is supplied", async () => {
		const cfg = await loadConfig(
			fixturePath("sumeru.gateway-config-empty.yaml"),
		);
		expect(cfg.gateways.hermes?.config).toEqual({});
		expect(cfg.gateways.hermes?.config).not.toBeNull();
	});

	it("yields null when `config: null` is supplied", async () => {
		const cfg = await loadConfig(
			fixturePath("sumeru.gateway-config-null.yaml"),
		);
		expect(cfg.gateways.hermes?.config).toBeNull();
	});

	it("yields null on every gateway when `config:` is absent", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.valid.yaml"));
		expect(cfg.gateways.hermes?.config).toBeNull();
		expect(cfg.gateways["claude-code"]?.config).toBeNull();
	});

	it("rejects when `config` is a number, naming the path / gateway / field", async () => {
		const path = fixturePath("sumeru.gateway-config-not-object.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/config/);
		await expect(loadConfig(path)).rejects.toThrow(/hermes/);
		await expect(loadConfig(path)).rejects.toThrow(path);
		await expect(loadConfig(path)).rejects.toThrow(/number/);
	});

	it("rejects when `config` is an array, naming the path / gateway / field", async () => {
		const path = fixturePath("sumeru.gateway-config-array.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/config/);
		await expect(loadConfig(path)).rejects.toThrow(/hermes/);
		await expect(loadConfig(path)).rejects.toThrow(path);
		await expect(loadConfig(path)).rejects.toThrow(/array/);
	});

	it("does not validate the contents of `config` (arbitrary keys pass through)", async () => {
		const cfg = await loadConfig(
			fixturePath("sumeru.gateway-with-config.yaml"),
		);
		const blob = cfg.gateways["claude-code"]?.config as Record<string, unknown>;
		// Any adapter-specific key is preserved verbatim. The parser does not
		// validate against any adapter's schema.
		expect(blob.sendTimeoutMs).toBe(1800000);
		expect(blob.maxTurns).toBe(120);
	});

	it("regression: existing fixtures still parse with `config: null` defaulted", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.two-gateways.yaml"));
		for (const gw of Object.values(cfg.gateways)) {
			expect(gw.config).toBeNull();
		}
	});
});
