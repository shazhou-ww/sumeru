import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	expandEnvVars,
	loadHostConfig,
	mergeSessionEnv,
	resolveSessionModel,
	validateComposeProjectVolume,
} from "../src/config.js";
import { openDatabase, type SqliteStore } from "../src/sqlite-store.js";

function writeV3HostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			"maxRunning: 3",
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
		].join("\n"),
	);
}

describe("mergeSessionEnv", () => {
	it("loads env vars from envFile", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-merge-env-"));
		const envFile = join(rootDir, ".env");
		writeFileSync(
			envFile,
			["# host defaults", "HOST_KEY=from-file", "SHARED=from-file", ""].join(
				"\n",
			),
		);

		await expect(mergeSessionEnv(envFile, null)).resolves.toEqual({
			HOST_KEY: "from-file",
			SHARED: "from-file",
		});
	});

	it("session env overrides envFile values", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-merge-env-override-"));
		const envFile = join(rootDir, ".env");
		writeFileSync(envFile, "SHARED=from-file\nONLY_FILE=yes\n");

		await expect(
			mergeSessionEnv(envFile, { SHARED: "from-session", SESSION_ONLY: "yes" }),
		).resolves.toEqual({
			SHARED: "from-session",
			ONLY_FILE: "yes",
			SESSION_ONLY: "yes",
		});
	});

	it("does not throw when envFile is missing", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-merge-env-missing-"));
		const envFile = join(rootDir, "missing.env");

		await expect(mergeSessionEnv(envFile, { A: "1" })).resolves.toEqual({
			A: "1",
		});
		await expect(mergeSessionEnv(envFile, null)).resolves.toEqual({});
	});
});

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
				"persona: worker-persona",
				"model: worker-model",
				"adapter: sarsapa",
			].join("\n"),
		);

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.config.name).toBe("test-host");
		expect(loaded.config.maxRunning).toBe(3);
		expect(loaded.config.workspaceRoot).toBe("/tmp/workspaces");
		expect(loaded.skillsDir).toBe(join(dataDir, "skills"));
		expect(loaded.prototypesDir).toBe(join(dataDir, "prototypes"));

		const prototype = loaded.prototypes.get("worker");
		expect(prototype?.prototype.persona).toBe("worker-persona");
		expect(prototype?.prototype.model).toBe("worker-model");
		expect(prototype?.prototype.adapter).toBe("sarsapa");
		expect(prototype?.prototypeHash).toMatch(/^[a-f0-9]{64}$/);
		expect(loaded.images.size).toBe(0);

		const skill = loaded.sqliteStore.getSkill("demo");
		expect(skill?.content).toBe("# Demo skill\n");
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

	it("logs deprecation warning for models section (does not error)", async () => {
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
				"    apiKey: sk-test",
			].join("\n"),
		);
		mkdirSync(join(rootDir, "data", "skills"), { recursive: true });
		mkdirSync(join(rootDir, "data", "prototypes"), { recursive: true });

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.config.name).toBe("test-host");
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

describe("resolveSessionModel", () => {
	let store: SqliteStore;

	afterEach(() => {
		store?.close();
	});

	function seedStore(): SqliteStore {
		store = openDatabase(":memory:");
		store.createProvider({
			name: "my-anthropic",
			apiType: "anthropic",
			baseUrl: null,
			apiKey: "sk-real-key-1234",
		});
		store.createProvider({
			name: "local-proxy",
			apiType: "openai",
			baseUrl: "http://localhost:8080",
			apiKey: "sk-proxy-key",
		});
		store.createModel({
			id: "default-model",
			provider: "my-anthropic",
			model: "claude-sonnet-4",
			contextWindow: null,
			toolUse: true,
			streaming: true,
			metadata: null,
		});
		store.createModel({
			id: "proxy-model",
			provider: "local-proxy",
			model: "gpt-4o",
			contextWindow: 128000,
			toolUse: true,
			streaming: true,
			metadata: null,
		});
		return store;
	}

	it("uses prototype model when override is null", () => {
		const s = seedStore();
		const config = resolveSessionModel(s, "default-model", null, "custom-only");
		expect(config.name).toBe("claude-sonnet-4");
		expect(config.apiKey).toBe("sk-real-key-1234");
		expect(typeof config.provider).toBe("object");
		if (typeof config.provider === "object") {
			expect(config.provider.name).toBe("my-anthropic");
			expect(config.provider.endpoint).toBe("https://api.anthropic.com");
			expect(config.provider.apiType).toBe("anthropic");
		}
	});

	it("uses string override as model id", () => {
		const s = seedStore();
		const config = resolveSessionModel(
			s,
			"default-model",
			"proxy-model",
			"custom-only",
		);
		expect(config.name).toBe("gpt-4o");
		expect(config.apiKey).toBe("sk-proxy-key");
		if (typeof config.provider === "object") {
			expect(config.provider.endpoint).toBe("http://localhost:8080");
			expect(config.provider.apiType).toBe("openai");
		}
	});

	it("uses ad-hoc object override directly", () => {
		const s = seedStore();
		const config = resolveSessionModel(
			s,
			"default-model",
			{
				provider: {
					name: "custom",
					endpoint: "http://test:9090",
					apiType: "openai",
				},
				name: "custom-model",
			},
			"custom-only",
		);
		expect(config.name).toBe("custom-model");
		expect(config.apiKey).toBeNull();
		expect(typeof config.provider).toBe("object");
		if (typeof config.provider === "object") {
			expect(config.provider.endpoint).toBe("http://test:9090");
		}
	});

	it("returns synthetic model config for builtin-only with null model", () => {
		const s = seedStore();
		const config = resolveSessionModel(s, null, null, "builtin-only");
		expect(config.name).toBe("auto");
		expect(config.apiKey).toBeNull();
		if (typeof config.provider === "object") {
			expect(config.provider.name).toBe("builtin");
		}
	});

	it("throws when model id is not found", () => {
		const s = seedStore();
		expect(() =>
			resolveSessionModel(s, "missing-model", null, "custom-only"),
		).toThrow("model_not_found:missing-model");
	});

	it("uses default openai endpoint when baseUrl is null", () => {
		store = openDatabase(":memory:");
		store.createProvider({
			name: "openai-default",
			apiType: "openai",
			baseUrl: null,
			apiKey: "sk-oai",
		});
		store.createModel({
			id: "oai-model",
			provider: "openai-default",
			model: "gpt-4o-mini",
			contextWindow: null,
			toolUse: true,
			streaming: true,
			metadata: null,
		});
		const config = resolveSessionModel(store, "oai-model", null, "custom-only");
		if (typeof config.provider === "object") {
			expect(config.provider.endpoint).toBe("https://api.openai.com/v1");
		}
	});
});

describe("expandEnvVars", () => {
	const savedEnv: Record<string, string | undefined> = {};

	afterEach(() => {
		for (const [key, val] of Object.entries(savedEnv)) {
			if (val === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = val;
			}
		}
		for (const key of Object.keys(savedEnv)) {
			delete savedEnv[key];
		}
	});

	function setEnv(key: string, value: string): void {
		savedEnv[key] = process.env[key];
		process.env[key] = value;
	}

	function unsetEnv(key: string): void {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}

	it("expands ${VAR} from process.env", () => {
		setEnv("MY_VAR", "hello-world");
		const result = expandEnvVars("apiKey: ${MY_VAR}", "test");
		expect(result).toBe("apiKey: hello-world");
	});

	it("applies ${VAR:-default} fallback when VAR is not set", () => {
		unsetEnv("MISSING_VAR");
		const result = expandEnvVars(
			"apiKey: ${MISSING_VAR:-fallback-key}",
			"test",
		);
		expect(result).toBe("apiKey: fallback-key");
	});

	it("prefers env value over default when VAR is set", () => {
		setEnv("PRESENT_VAR", "real-value");
		const result = expandEnvVars("apiKey: ${PRESENT_VAR:-fallback}", "test");
		expect(result).toBe("apiKey: real-value");
	});

	it("leaves plain YAML without env vars unchanged", () => {
		const yaml = "name: test-host\nmaxRunning: 3\n";
		expect(expandEnvVars(yaml, "test")).toBe(yaml);
	});

	it("throws when VAR is not set and has no default", () => {
		unsetEnv("UNSET_NO_DEFAULT");
		expect(() => expandEnvVars("key: ${UNSET_NO_DEFAULT}", "ctx")).toThrow(
			"UNSET_NO_DEFAULT",
		);
	});
});

describe("loadHostConfig — env var expansion", () => {
	const savedEnv: Record<string, string | undefined> = {};

	afterEach(() => {
		for (const [key, val] of Object.entries(savedEnv)) {
			if (val === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = val;
			}
		}
		for (const key of Object.keys(savedEnv)) {
			delete savedEnv[key];
		}
	});

	function setEnv(key: string, value: string): void {
		savedEnv[key] = process.env[key];
		process.env[key] = value;
	}

	it("expands env vars in YAML before parsing", async () => {
		setEnv("TEST_WS_ROOT", "/tmp/workspaces-expanded");
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-envvar-"));
		mkdirSync(join(rootDir, "data", "skills"), { recursive: true });
		mkdirSync(join(rootDir, "data", "prototypes"), { recursive: true });
		writeFileSync(
			join(rootDir, "host.yaml"),
			[
				"name: test-host",
				"maxRunning: 3",
				"workspaceRoot: ${TEST_WS_ROOT}",
				"envFile: /dev/null",
			].join("\n"),
		);

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.config.workspaceRoot).toBe("/tmp/workspaces-expanded");
	});

	it("uses default when env var is not set", async () => {
		savedEnv["NONEXISTENT_KEY"] = process.env["NONEXISTENT_KEY"];
		delete process.env["NONEXISTENT_KEY"];

		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-envdefault-"));
		mkdirSync(join(rootDir, "data", "skills"), { recursive: true });
		mkdirSync(join(rootDir, "data", "prototypes"), { recursive: true });
		writeFileSync(
			join(rootDir, "host.yaml"),
			[
				"name: test-host",
				"maxRunning: 3",
				"workspaceRoot: ${NONEXISTENT_KEY:-/tmp/default-ws}",
				"envFile: /dev/null",
			].join("\n"),
		);

		const loaded = await loadHostConfig(rootDir);
		expect(loaded.config.workspaceRoot).toBe("/tmp/default-ws");
	});
});

describe("skill auto-migration from files", () => {
	it("imports .md files into SQLite on first load", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-skill-migrate-"));
		writeV3HostFixture(rootDir);
		const dataDir = join(rootDir, "data");
		mkdirSync(join(dataDir, "skills"), { recursive: true });
		mkdirSync(join(dataDir, "prototypes"), { recursive: true });
		writeFileSync(join(dataDir, "skills", "alpha.md"), "# Alpha\n");
		writeFileSync(join(dataDir, "skills", "beta.md"), "# Beta\n");

		const loaded = await loadHostConfig(rootDir);
		const skills = loaded.sqliteStore.listSkills();
		expect(skills).toHaveLength(2);
		expect(skills.map((s) => s.name).sort()).toEqual(["alpha", "beta"]);
		expect(loaded.sqliteStore.getSkill("alpha")?.content).toBe("# Alpha\n");
	});

	it("does not re-import when skills table already has data", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-skill-noreimport-"));
		writeV3HostFixture(rootDir);
		const dataDir = join(rootDir, "data");
		mkdirSync(join(dataDir, "skills"), { recursive: true });
		mkdirSync(join(dataDir, "prototypes"), { recursive: true });
		writeFileSync(join(dataDir, "skills", "old.md"), "# Old\n");

		const first = await loadHostConfig(rootDir);
		expect(first.sqliteStore.listSkills()).toHaveLength(1);
		first.sqliteStore.close();

		writeFileSync(join(dataDir, "skills", "new.md"), "# New\n");
		const second = await loadHostConfig(rootDir);
		expect(second.sqliteStore.listSkills()).toHaveLength(1);
		expect(second.sqliteStore.getSkill("new")).toBeNull();
	});
});
