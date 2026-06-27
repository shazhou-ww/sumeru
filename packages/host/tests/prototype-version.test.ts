import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { computePrototypeHash, loadHostConfig } from "../src/config.js";
import { createInstanceManager } from "../src/instance-manager.js";
import type { Transport, TransportExecSession } from "../src/types.js";

function writePrototypeFixture(
	rootDir: string,
	options: {
		instructions?: string;
		skillContent?: string;
	} = {},
): string {
	const prototypeDir = join(rootDir, "prototypes", "claude-code");
	mkdirSync(join(prototypeDir, "skills", "demo"), { recursive: true });
	writeFileSync(
		join(prototypeDir, "compose.yaml"),
		"services:\n  agent:\n    image: example\n",
	);
	writeFileSync(
		join(prototypeDir, "manifest.yaml"),
		[
			"name: claude-code",
			`instructions: ${options.instructions ?? "You are a worker."}`,
			"skills:",
			"  - demo",
			"model:",
			"  provider: anthropic",
			"  name: claude-sonnet-4",
			"  apiKeyEnv: ANTHROPIC_API_KEY",
			"  contextWindow: 200000",
		].join("\n"),
	);
	writeFileSync(
		join(prototypeDir, "skills", "demo", "SKILL.md"),
		options.skillContent ?? "demo skill",
	);
	return prototypeDir;
}

function writeHostFixture(rootDir: string): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			"master:",
			"  adapter: claude-code",
			"  config: {}",
			"resources:",
			"  maxMemory: 4g",
			"  maxCpus: 2",
			"  maxInstances: 4",
		].join("\n"),
	);
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
		exec() {
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

	it("changes when manifest.yaml content changes", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-hash-"));
		tempDirs.push(rootDir);
		const prototypeDir = writePrototypeFixture(rootDir, {
			instructions: "Version one.",
		});
		const manifestPath = join(prototypeDir, "manifest.yaml");
		const skillsDir = join(prototypeDir, "skills");
		const first = await computePrototypeHash(manifestPath, skillsDir);
		writeFileSync(
			manifestPath,
			[
				"name: claude-code",
				"instructions: Version two.",
				"skills:",
				"  - demo",
				"model:",
				"  provider: anthropic",
				"  name: claude-sonnet-4",
				"  apiKeyEnv: ANTHROPIC_API_KEY",
				"  contextWindow: 200000",
			].join("\n"),
		);
		const second = await computePrototypeHash(manifestPath, skillsDir);
		expect(first).not.toBe(second);
		expect(first).toMatch(/^[a-f0-9]{64}$/);
	});

	it("changes when skills/ content changes", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-hash-"));
		tempDirs.push(rootDir);
		const prototypeDir = writePrototypeFixture(rootDir, {
			skillContent: "skill v1",
		});
		const manifestPath = join(prototypeDir, "manifest.yaml");
		const skillsDir = join(prototypeDir, "skills");
		const first = await computePrototypeHash(manifestPath, skillsDir);
		writeFileSync(join(prototypeDir, "skills", "demo", "SKILL.md"), "skill v2");
		const second = await computePrototypeHash(manifestPath, skillsDir);
		expect(first).not.toBe(second);
	});

	it("stores prototypeHash when loading host config", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-hash-"));
		tempDirs.push(rootDir);
		writeHostFixture(rootDir);
		writePrototypeFixture(rootDir);
		const hostConfig = await loadHostConfig(rootDir);
		const prototype = hostConfig.prototypes.get("claude-code");
		expect(prototype?.prototypeHash).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe("prototype lazy re-init", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		tempDirs.length = 0;
	});

	it("re-inits adapter when prototype hash changes between inbox messages", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-proto-reinit-"));
		tempDirs.push(rootDir);
		writeHostFixture(rootDir);
		writePrototypeFixture(rootDir, { instructions: "Version one." });
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, initCount } = createInitTrackingTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		const created = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});

		await manager.submitInbox(created.id, {
			messageId: "msg_1",
			content: "hello",
			project: null,
		});
		await waitUntil(() => initCount() >= 1);
		expect(manager.getInstance(created.id)?.initVersion).toBe(
			hostConfig.prototypes.get("claude-code")?.prototypeHash,
		);

		const prototype = hostConfig.prototypes.get("claude-code");
		if (prototype === undefined) {
			throw new Error("prototype missing");
		}
		writeFileSync(
			prototype.manifestPath,
			[
				"name: claude-code",
				"instructions: Version two.",
				"skills:",
				"  - demo",
				"model:",
				"  provider: anthropic",
				"  name: claude-sonnet-4",
				"  apiKeyEnv: ANTHROPIC_API_KEY",
				"  contextWindow: 200000",
			].join("\n"),
		);
		prototype.manifest.instructions = "Version two.";
		prototype.prototypeHash = await computePrototypeHash(
			prototype.manifestPath,
			join(hostConfig.prototypesDir, "claude-code", "skills"),
		);

		await manager.submitInbox(created.id, {
			messageId: "msg_2",
			content: "hello again",
			project: null,
		});
		await waitUntil(() => initCount() >= 2);
		expect(initCount()).toBe(2);
		expect(manager.getInstance(created.id)?.initVersion).toBe(
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
