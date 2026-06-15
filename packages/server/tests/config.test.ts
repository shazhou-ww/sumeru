import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/index.js";

function fixturePath(name: string): string {
	const url = new URL(`./fixtures/${name}`, import.meta.url);
	return fileURLToPath(url);
}

describe("loadConfig — valid input", () => {
	it("parses sumeru.valid.yaml into a fully-typed InstanceConfig", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.valid.yaml"));
		expect(cfg).toEqual({
			name: "sumeru@neko",
			workspaceRoot: null,
			gateways: {
				hermes: {
					adapter: "hermes",
					capabilities: { resume: true, streaming: true },
					config: null,
				},
				"claude-code": {
					adapter: "claude-code",
					capabilities: { resume: true, streaming: false },
					config: null,
				},
			},
		});
	});

	it("preserves gateway insertion order from the YAML", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.valid.yaml"));
		expect(Object.keys(cfg.gateways)).toEqual(["hermes", "claude-code"]);
	});

	it("tolerates unknown top-level keys and unknown gateway keys", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.unknown-fields.yaml"));
		expect(cfg.name).toBe("sumeru@neko");
		expect(cfg.gateways.hermes).toEqual({
			adapter: "hermes",
			capabilities: { resume: true, streaming: true },
			config: null,
		});
		// Unknown gateway field "foo" must NOT appear in the parsed entry.
		expect(
			(cfg.gateways.hermes as unknown as Record<string, unknown>).foo,
		).toBeUndefined();
	});

	it("treats a missing `gateways` block as an empty map", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.no-gateways.yaml"));
		expect(cfg.name).toBe("sumeru@empty");
		expect(cfg.gateways).toEqual({});
	});
});

describe("loadConfig — workspaceRoot (issue #27)", () => {
	it("yields workspaceRoot=null when the field is absent", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.valid.yaml"));
		expect(cfg.workspaceRoot).toBeNull();
		// Original keys preserved.
		expect(cfg.name).toBe("sumeru@neko");
		expect(Object.keys(cfg.gateways)).toEqual(["hermes", "claude-code"]);
	});

	it("parses a non-empty workspaceRoot verbatim (no resolution)", async () => {
		const cfg = await loadConfig(fixturePath("sumeru.workspace-root.yaml"));
		expect(cfg.workspaceRoot).toBe("/tmp/sumeru-test-workspace");
		expect(cfg.name).toBe("sumeru@test");
		expect(Object.keys(cfg.gateways).sort()).toEqual(["claude-code", "hermes"]);
	});

	it("folds an empty-string workspaceRoot to null", async () => {
		const cfg = await loadConfig(
			fixturePath("sumeru.workspace-root-empty.yaml"),
		);
		expect(cfg.workspaceRoot).toBeNull();
	});

	it("rejects when workspaceRoot is the wrong type", async () => {
		const path = fixturePath("sumeru.workspace-root-not-string.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/workspaceRoot/);
		await expect(loadConfig(path)).rejects.toThrow(path);
		await expect(loadConfig(path)).rejects.toThrow(/string/);
	});
});

describe("loadConfig — error paths", () => {
	it("throws when `name` is missing, mentioning the field and path", async () => {
		const path = fixturePath("sumeru.missing-name.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/name/);
		await expect(loadConfig(path)).rejects.toThrow(path);
	});

	it("throws when `gateways` is an array, mentioning gateways and path", async () => {
		const path = fixturePath("sumeru.gateways-not-object.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/gateways/);
		await expect(loadConfig(path)).rejects.toThrow(path);
	});

	it("throws when a gateway entry is missing `adapter`", async () => {
		const path = fixturePath("sumeru.gateway-missing-adapter.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/adapter/);
		await expect(loadConfig(path)).rejects.toThrow(path);
	});

	it("throws when a gateway entry is missing `capabilities`", async () => {
		const path = fixturePath("sumeru.gateway-missing-capabilities.yaml");
		await expect(loadConfig(path)).rejects.toThrow(/capabilities/);
		await expect(loadConfig(path)).rejects.toThrow(path);
	});

	it("throws an Error (not raw YAML error) when YAML is malformed", async () => {
		const path = fixturePath("sumeru.bad-yaml.yaml");
		await expect(loadConfig(path)).rejects.toThrow(Error);
		await expect(loadConfig(path)).rejects.toThrow(path);
	});

	it("throws a friendly Error (not raw ENOENT) when the file is missing", async () => {
		const path = fixturePath("sumeru.does-not-exist.yaml");
		const promise = loadConfig(path);
		await expect(promise).rejects.toThrow(Error);
		await expect(promise).rejects.toThrow(path);
		await expect(promise).rejects.toThrow(/not found|cannot be read/);
	});
});
