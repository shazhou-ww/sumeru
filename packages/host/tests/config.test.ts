import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	defaultModelFromHostConfig,
	loadHostConfig,
	resolveModelConfig,
	validateComposeProjectVolume,
} from "../src/config.js";

function writeV3HostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			"maxRunning: 3",
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
			"models:",
			"  anthropic:",
			"    baseUrl: null",
			"    apiKey: sk-test",
			"  openai: null",
			"  openrouter: null",
		].join("\n"),
	);
}

describe("loadHostConfig — v3 HostConfig", () => {
	it("loads host.yaml and scans dataDir prototypes/skills", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-config-"));
		writeV3HostFixture(rootDir);
		const dataDir = join(rootDir, "data");
		mkdirSync(join(dataDir, "skills"), { recursive: true });
		mkdirSync(join(dataDir, "prototypes"), { recursive: true });
		writeFileSync(join(dataDir, "skills", "demo.md"), "# Demo skill\n");
		writeFileSync(
			join(dataDir, "prototypes", "worker.yaml"),
			[
				"name: worker",
				"instructions: You are a worker.",
				"skills:",
				"  - demo",
			].join("\n"),
		);

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.config.name).toBe("test-host");
		expect(loaded.config.maxRunning).toBe(3);
		expect(loaded.config.workspaceRoot).toBe("/tmp/workspaces");
		expect(loaded.skillsDir).toBe(join(dataDir, "skills"));
		expect(loaded.prototypesDir).toBe(join(dataDir, "prototypes"));

		const prototype = loaded.prototypes.get("worker");
		expect(prototype?.prototype.instructions).toBe("You are a worker.");
		expect(prototype?.prototype.skills).toEqual(["demo"]);
		expect(prototype?.prototypeHash).toMatch(/^[a-f0-9]{64}$/);
		expect(loaded.images.size).toBe(0);
	});

	it("loads embedded images from host.yaml", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-config-"));
		writeFileSync(
			join(rootDir, "host.yaml"),
			[
				"name: test-host",
				"maxRunning: 3",
				"workspaceRoot: /tmp/workspaces",
				"envFile: /dev/null",
				"models:",
				"  anthropic:",
				"    baseUrl: null",
				"    apiKey: sk-test",
				"  openai: null",
				"  openrouter: null",
				"images:",
				"  worker:",
				'    description: "Worker"',
				'    dockerfile: "CAS001"',
				'    builtAt: "2026-06-29T00:00:00.000Z"',
				'    digest: "sha256:abc"',
			].join("\n"),
		);
		mkdirSync(join(rootDir, "data", "skills"), { recursive: true });
		mkdirSync(join(rootDir, "data", "prototypes"), { recursive: true });

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.images.get("worker")).toEqual({
			name: "worker",
			description: "Worker",
			dockerfile: "CAS001",
			builtAt: "2026-06-29T00:00:00.000Z",
			digest: "sha256:abc",
		});
	});
});

describe("validateComposeProjectVolume", () => {
	it("accepts compose files that bind-mount SUMERU_PROJECT_PATH", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-compose-valid-"));
		const composePath = join(rootDir, "compose.yaml");
		writeFileSync(
			composePath,
			[
				"services:",
				"  agent:",
				"    image: example",
				"    volumes:",
				`      - "${"$" + "{SUMERU_PROJECT_PATH}:$" + "{SUMERU_PROJECT_PATH}"}"`,
			].join("\n"),
		);
		await expect(
			validateComposeProjectVolume(composePath),
		).resolves.toBeUndefined();
	});

	it("rejects compose files without project volume mount", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-compose-invalid-"));
		const composePath = join(rootDir, "compose.yaml");
		writeFileSync(composePath, "services:\n  agent:\n    image: example\n");
		await expect(validateComposeProjectVolume(composePath)).rejects.toThrow(
			"SUMERU_PROJECT_PATH",
		);
	});
});

describe("defaultModelFromHostConfig — baseUrl promotion", () => {
	const baseConfig = {
		name: "test",
		maxRunning: 1,
		workspaceRoot: "/tmp",
		envFile: "/dev/null",
		resourceLimits: null,
		defaults: null,
	};

	it("returns KnownProvider when baseUrl is null", () => {
		const model = defaultModelFromHostConfig({
			...baseConfig,
			models: {
				anthropic: { baseUrl: null, apiKey: "sk-test" },
				openai: null,
				openrouter: null,
			},
		});
		expect(model.provider).toBe("anthropic");
		expect(model.apiKey).toBe("sk-test");
	});

	it("promotes to CustomProvider when baseUrl is set", () => {
		const model = defaultModelFromHostConfig({
			...baseConfig,
			models: {
				anthropic: {
					baseUrl: "http://host.docker.internal:4141",
					apiKey: "sk-proxy",
				},
				openai: null,
				openrouter: null,
			},
		});
		expect(typeof model.provider).toBe("object");
		if (typeof model.provider === "object") {
			expect(model.provider.name).toBe("anthropic");
			expect(model.provider.endpoint).toBe("http://host.docker.internal:4141");
			expect(model.provider.apiType).toBe("anthropic");
		}
		expect(model.apiKey).toBe("sk-proxy");
		expect(model.name).toBe("claude-sonnet-4");
	});
});

describe("resolveModelConfig — baseUrl promotion", () => {
	const hostConfig = {
		name: "test",
		maxRunning: 1,
		workspaceRoot: "/tmp",
		envFile: "/dev/null",
		models: {
			anthropic: {
				baseUrl: "http://host.docker.internal:4141",
				apiKey: "sk-proxy",
			},
			openai: null,
			openrouter: null,
		},
		resourceLimits: null,
		defaults: null,
	};

	it("promotes known provider with baseUrl when using default model", () => {
		const model = resolveModelConfig(hostConfig, null);
		expect(typeof model.provider).toBe("object");
		if (typeof model.provider === "object") {
			expect(model.provider.endpoint).toBe("http://host.docker.internal:4141");
		}
	});

	it("promotes known provider with baseUrl when explicitly requested", () => {
		const model = resolveModelConfig(hostConfig, {
			provider: "anthropic",
			name: "claude-opus-4",
		});
		expect(typeof model.provider).toBe("object");
		if (typeof model.provider === "object") {
			expect(model.provider.endpoint).toBe("http://host.docker.internal:4141");
		}
		expect(model.name).toBe("claude-opus-4");
		expect(model.apiKey).toBe("sk-proxy");
	});

	it("keeps known provider when baseUrl is null", () => {
		const noBaseUrl = {
			...hostConfig,
			models: {
				anthropic: { baseUrl: null, apiKey: "sk-real" },
				openai: null,
				openrouter: null,
			},
		};
		const model = resolveModelConfig(noBaseUrl, null);
		expect(model.provider).toBe("anthropic");
		expect(model.apiKey).toBe("sk-real");
	});
});
