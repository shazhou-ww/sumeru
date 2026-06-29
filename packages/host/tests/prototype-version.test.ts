import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { computePrototypeHash, loadHostConfig } from "../src/config.js";
import { createSessionManager } from "../src/session-manager.js";
import type { Transport, TransportExecSession } from "../src/types.js";

function writeV3HostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			"maxRunning: 4",
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
	mkdirSync("/tmp/workspaces/demo", { recursive: true });
}

function writePrototypeFixture(
	rootDir: string,
	options: {
		instructions?: string;
		skillContent?: string;
	} = {},
): { yamlPath: string; skillsDir: string; composePath: string } {
	const dataDir = join(rootDir, "data");
	const skillsDir = join(dataDir, "skills");
	const prototypesDir = join(dataDir, "prototypes");
	mkdirSync(skillsDir, { recursive: true });
	mkdirSync(prototypesDir, { recursive: true });
	writeFileSync(
		join(skillsDir, "demo.md"),
		options.skillContent ?? "demo skill",
	);
	const yamlPath = join(prototypesDir, "claude-code.yaml");
	writeFileSync(
		yamlPath,
		[
			"name: claude-code",
			`instructions: ${options.instructions ?? "You are a worker."}`,
			"skills:",
			"  - demo",
		].join("\n"),
	);
	const legacyPrototypeDir = join(rootDir, "prototypes", "claude-code");
	mkdirSync(legacyPrototypeDir, { recursive: true });
	const composePath = join(legacyPrototypeDir, "compose.yaml");
	writeFileSync(composePath, "services:\n  agent:\n    image: example\n");
	return { yamlPath, skillsDir, composePath };
}

function createInitTrackingTransport(): {
	transport: Transport;
	initCount: () => number;
} {
	let inits = 0;
	const transport: Transport = {
		async up(input) {
			return { containerId: `container-${input.projectName}` };
		},
		async down() {},
		async rm() {},
		exec(_input) {
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			stdin.on("data", (chunk: Buffer | string) => {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				if (text.includes('"init"')) {
					inits += 1;
					stdout.write(`${JSON.stringify({ type: "ready", value: {} })}\n`);
				}
				if (text.includes('"message"')) {
					stdout.write(
						`${JSON.stringify({
							type: "done",
							value: { summary: "ok", tokenUsage: null },
						})}\n`,
					);
				}
			});
			const rl = createInterface({ input: stdout, crlfDelay: Infinity });
			const session: TransportExecSession = {
				stdin,
				lines: rl,
				waitForExit: async () => ({ exitCode: 0, stderr: "" }),
			};
			return session;
		},
		async inspectStatus() {
			return "running";
		},
	};
	return {
		transport,
		initCount: () => inits,
	};
}

describe("computePrototypeHash", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		tempDirs.length = 0;
	});

	it("changes when prototype yaml content changes", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-hash-"));
		tempDirs.push(rootDir);
		writeV3HostFixture(rootDir);
		const { yamlPath, skillsDir } = writePrototypeFixture(rootDir, {
			instructions: "Version one.",
		});
		const hostConfig = await loadHostConfig(rootDir);
		const prototype = hostConfig.prototypes.get("claude-code");
		if (prototype === undefined) throw new Error("prototype missing");
		const first = await computePrototypeHash(
			yamlPath,
			skillsDir,
			prototype.prototype,
		);
		writeFileSync(
			yamlPath,
			[
				"name: claude-code",
				"instructions: Version two.",
				"skills:",
				"  - demo",
			].join("\n"),
		);
		prototype.prototype.instructions = "Version two.";
		const second = await computePrototypeHash(
			yamlPath,
			skillsDir,
			prototype.prototype,
		);
		expect(first).not.toBe(second);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
	});

	it("changes when skill file content changes", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-hash-"));
		tempDirs.push(rootDir);
		writeV3HostFixture(rootDir);
		const { yamlPath, skillsDir } = writePrototypeFixture(rootDir, {
			skillContent: "skill v1",
		});
		const hostConfig = await loadHostConfig(rootDir);
		const prototype = hostConfig.prototypes.get("claude-code");
		if (prototype === undefined) throw new Error("prototype missing");
		const first = await computePrototypeHash(
			yamlPath,
			skillsDir,
			prototype.prototype,
		);
		writeFileSync(join(skillsDir, "demo.md"), "skill v2");
		const second = await computePrototypeHash(
			yamlPath,
			skillsDir,
			prototype.prototype,
		);
		expect(first).not.toBe(second);
	});

	it("stores prototypeHash when loading host config", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-hash-"));
		tempDirs.push(rootDir);
		writeV3HostFixture(rootDir);
		writePrototypeFixture(rootDir);
		const hostConfig = await loadHostConfig(rootDir);
		const prototype = hostConfig.prototypes.get("claude-code");
		expect(prototype?.prototypeHash).toMatch(/^[a-f0-9]{64}$/);
		expect(prototype?.composePath).toContain("compose.yaml");
	});
});

describe("prototype lazy re-init", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		tempDirs.length = 0;
	});

	it("re-inits adapter when prototype hash changes between messages", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-reinit-"));
		tempDirs.push(rootDir);
		writeV3HostFixture(rootDir);
		const { yamlPath, skillsDir } = writePrototypeFixture(rootDir, {
			instructions: "Version one.",
		});
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, initCount } = createInitTrackingTransport();
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession({
			prototype: "claude-code",
			project: "demo",
			task: "hello",
			model: null,
			env: null,
		});
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");
		expect(manager.getSession(created.id)?.initVersion).toBe(
			hostConfig.prototypes.get("claude-code")?.prototypeHash,
		);

		const prototype = hostConfig.prototypes.get("claude-code");
		if (prototype === undefined) {
			throw new Error("prototype missing");
		}
		writeFileSync(
			yamlPath,
			[
				"name: claude-code",
				"instructions: Version two.",
				"skills:",
				"  - demo",
			].join("\n"),
		);
		prototype.prototype.instructions = "Version two.";
		prototype.prototypeHash = await computePrototypeHash(
			yamlPath,
			skillsDir,
			prototype.prototype,
		);

		await manager.submitMessage(created.id, {
			messageId: "msg_2",
			content: "hello again",
			env: null,
			model: null,
		});
		await waitUntil(() => initCount() >= 2);
		expect(initCount()).toBe(2);
		expect(manager.getSession(created.id)?.initVersion).toBe(
			prototype.prototypeHash,
		);
	});
});

async function waitUntil(
	predicate: () => boolean,
	timeoutMs = 2_000,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("condition not met before timeout");
}
