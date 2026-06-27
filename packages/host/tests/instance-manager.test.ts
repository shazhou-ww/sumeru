import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { generateInstanceId, MASTER_INSTANCE_ID } from "../src/id.js";
import { createInstanceManager } from "../src/instance-manager.js";
import type { Transport, TransportExecSession } from "../src/types.js";

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
			"  maxInstances: 2",
		].join("\n"),
	);
	const prototypeDir = join(rootDir, "prototypes", "claude-code");
	mkdirSync(prototypeDir, { recursive: true });
	writeFileSync(
		join(prototypeDir, "compose.yaml"),
		"services:\n  agent:\n    image: example\n",
	);
	writeFileSync(
		join(prototypeDir, "manifest.yaml"),
		[
			"name: claude-code",
			"instructions: You are a worker.",
			"skills: []",
			"model:",
			"  provider: anthropic",
			"  name: claude-sonnet-4",
			"  apiKeyEnv: ANTHROPIC_API_KEY",
			"  contextWindow: 200000",
		].join("\n"),
	);
}

function createInteractiveTransport(): {
	transport: Transport;
	calls: Array<string>;
} {
	const calls: Array<string> = [];
	const transport: Transport = {
		async up(input) {
			calls.push(`up:${input.projectName}`);
			return { containerId: `container-${input.projectName}` };
		},
		async down(input) {
			calls.push(`down:${input.projectName}`);
		},
		async rm(input) {
			calls.push(`rm:${input.projectName}`);
		},
		exec({ containerId, command }) {
			calls.push(`exec:${containerId}:${command.join(" ")}`);
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			stdin.on("data", (chunk: Buffer | string) => {
				const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
				if (text.includes('"init"')) {
					stdout.write(`${JSON.stringify({ type: "ready", value: {} })}\n`);
				}
				if (text.includes('"message"')) {
					stdout.write(
						`${JSON.stringify({
							type: "turn",
							value: {
								index: 0,
								role: "assistant",
								content: "pong",
								timestamp: "2026-06-27T00:00:00.000Z",
								toolCalls: null,
								tokens: null,
							},
						})}\n`,
					);
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
	return { transport, calls };
}

describe("instance-manager", () => {
	const tempDirs: Array<string> = [];

	afterEach(() => {
		tempDirs.length = 0;
	});

	function setup() {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-"));
		tempDirs.push(rootDir);
		writeHostFixture(rootDir);
		return rootDir;
	}

	it("starts with master instance inst_0", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		const instances = manager.listInstances();
		expect(instances).toHaveLength(1);
		expect(instances[0]?.id).toBe(MASTER_INSTANCE_ID);
		expect(instances[0]?.prototype).toBeNull();
	});

	it("creates and deletes docker-backed instances", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, calls } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });

		const created = await manager.createInstance({
			prototype: "claude-code",
			projects: ["/workspace"],
		});
		expect(created.id.startsWith("inst_")).toBe(true);
		expect(created.id).not.toBe(MASTER_INSTANCE_ID);
		expect(created.prototype).toBe("claude-code");
		expect(created.containerId).toContain("container-");
		expect(manager.listInstances()).toHaveLength(2);
		expect(calls.some((call) => call.startsWith("up:"))).toBe(true);

		await manager.deleteInstance(created.id);
		expect(manager.getInstance(created.id)).toBeNull();
		expect(calls.some((call) => call.startsWith("down:"))).toBe(true);
		expect(calls.some((call) => call.startsWith("rm:"))).toBe(true);
	});

	it("enforces maxInstances from host config", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		await manager.createInstance({ prototype: "claude-code", projects: null });
		await manager.createInstance({ prototype: "claude-code", projects: null });
		await expect(
			manager.createInstance({ prototype: "claude-code", projects: null }),
		).rejects.toThrow("max_instances_reached");
	});

	it("routes inbox through docker exec adapter process", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, calls } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		const created = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});

		const events: Array<{ event: string; id: number }> = [];
		const unsubscribe = manager.subscribeOutbox(created.id, (event) => {
			events.push({ event: event.event, id: event.id });
		});

		await manager.submitInbox(created.id, {
			messageId: "msg_1",
			content: "hello",
			project: null,
		});

		await waitUntil(() => events.some((event) => event.event === "done"));
		unsubscribe();
		expect(calls.some((call) => call.startsWith("exec:"))).toBe(true);
		expect(events.map((event) => event.event)).toEqual(["turn", "done"]);
		expect(events[0]?.id).toBe(1);
		expect(events[1]?.id).toBe(2);
	});

	it("resetInstance recreates the container", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, calls } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		const created = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});
		const reset = await manager.resetInstance(created.id);
		expect(reset.id).toBe(created.id);
		expect(
			calls.filter((call) => call.startsWith("down:")).length,
		).toBeGreaterThan(0);
		expect(
			calls.filter((call) => call.startsWith("up:")).length,
		).toBeGreaterThan(1);
	});

	it("generateInstanceId produces unique inst_ ids", () => {
		const a = generateInstanceId();
		const b = generateInstanceId();
		expect(a.startsWith("inst_")).toBe(true);
		expect(b.startsWith("inst_")).toBe(true);
		expect(a).not.toBe(b);
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
