import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { generateInstanceId, MASTER_INSTANCE_ID } from "../src/id.js";
import { createInstanceManager } from "../src/instance-manager.js";
import { LOCAL_MASTER_HANDLE } from "../src/local-transport.js";
import { createOcasRecorder } from "../src/ocas-recorder.js";
import type { Transport, TransportExecSession } from "../src/types.js";

function writeHostFixture(rootDir: string, maxInstances = 2): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			"master:",
			"  adapter: hermes",
			"  config:",
			"    profile: default",
			"    instructions: You are the master.",
			"    skills: []",
			"resources:",
			"  maxMemory: 4g",
			"  maxCpus: 2",
			`  maxInstances: ${maxInstances}`,
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
	upComposeContents: Array<string>;
} {
	const calls: Array<string> = [];
	const upComposeContents: Array<string> = [];
	const transport: Transport = {
		async up(input) {
			calls.push(`up:${input.projectName}`);
			if (input.projectName === "inst-0") {
				return { containerId: LOCAL_MASTER_HANDLE };
			}
			upComposeContents.push(readFileSync(input.composePath, "utf-8"));
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
			const instanceKey = containerId.replace("container-", "");
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
								content: `pong:${instanceKey}`,
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
	return { transport, calls, upComposeContents };
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

	it("bootMaster provisions local master handle", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		await manager.bootMaster();
		const master = manager.getInstance(MASTER_INSTANCE_ID);
		expect(master?.containerId).toBe(LOCAL_MASTER_HANDLE);
		expect(master?.status).toBe("running");
	});

	it("rejects deleting master instance", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		await expect(manager.deleteInstance(MASTER_INSTANCE_ID)).rejects.toThrow(
			"cannot_delete_master",
		);
	});

	it("routes master inbox through local adapter process", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, calls } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		await manager.bootMaster();

		const events: Array<{ event: string; data: string }> = [];
		const unsubscribe = manager.subscribeOutbox(MASTER_INSTANCE_ID, (event) => {
			events.push({ event: event.event, data: event.data });
		});

		await manager.submitInbox(MASTER_INSTANCE_ID, {
			messageId: "msg_master",
			content: "hello master",
			project: null,
		});

		await waitUntil(() => events.some((event) => event.event === "done"));
		unsubscribe();
		expect(
			calls.some((call) => call.startsWith(`exec:${LOCAL_MASTER_HANDLE}:`)),
		).toBe(true);
		expect(events.map((event) => event.event)).toEqual(["turn", "done"]);
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

	it("enforces maxInstances from host config for running instances", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		await manager.createInstance({ prototype: "claude-code", projects: null });
		await manager.createInstance({ prototype: "claude-code", projects: null });
		await expect(
			manager.createInstance({ prototype: "claude-code", projects: null }),
		).rejects.toThrow("resource_exhausted");
	});

	it("allows new instances when existing ones are suspended", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });
		const first = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});
		await manager.createInstance({ prototype: "claude-code", projects: null });
		const record = manager.getInstance(first.id);
		if (record !== null) {
			record.status = "suspended";
		}
		const third = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});
		expect(third.id.startsWith("inst_")).toBe(true);
	});

	it("runs three instances in parallel without shared state contamination", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-"));
		tempDirs.push(rootDir);
		writeHostFixture(rootDir, 10);
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createInstanceManager({ hostConfig, transport });

		const created = await Promise.all([
			manager.createInstance({ prototype: "claude-code", projects: null }),
			manager.createInstance({ prototype: "claude-code", projects: null }),
			manager.createInstance({ prototype: "claude-code", projects: null }),
		]);
		expect(new Set(created.map((item) => item.id)).size).toBe(3);

		const turnContents = new Map<string, string>();
		const unsubscribes = created.map((instance) => {
			return manager.subscribeOutbox(instance.id, (event) => {
				if (event.event !== "turn") return;
				const data = JSON.parse(event.data) as {
					value: { content: string };
				};
				turnContents.set(instance.id, data.value.content);
			});
		});

		await Promise.all(
			created.map((instance, index) =>
				manager.submitInbox(instance.id, {
					messageId: `msg_${index}`,
					content: `hello-${index}`,
					project: null,
				}),
			),
		);

		await waitUntil(() =>
			created.every((instance) => turnContents.has(instance.id)),
		);
		for (const unsubscribe of unsubscribes) {
			unsubscribe();
		}

		for (const instance of created) {
			const projectName = instance.projectName;
			expect(turnContents.get(instance.id)).toBe(`pong:${projectName}`);
		}
		expect(new Set(turnContents.values()).size).toBe(3);
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

		const events: Array<{ event: string; id: number; data: string }> = [];
		const unsubscribe = manager.subscribeOutbox(created.id, (event) => {
			events.push({ event: event.event, id: event.id, data: event.data });
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
		expect(JSON.parse(events[0]?.data ?? "{}")).toMatchObject({
			value: { content: expect.stringMatching(/^pong:/) },
		});
		expect(events[0]?.id).toBe(1);
		expect(events[1]?.id).toBe(2);
	});

	it("resetInstance recreates the container, clears history, and stops", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport, calls } = createInteractiveTransport();
		const recorder = createOcasRecorder(hostConfig.dataDir);
		const manager = createInstanceManager({ hostConfig, transport, recorder });
		const created = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});
		await manager.submitInbox(created.id, {
			messageId: "msg_1",
			content: "hello",
			project: null,
		});
		await waitUntil(() => recorder.getTurnTotal(created.id) > 0);
		expect(
			readFileSync(join(hostConfig.dataDir, `${created.id}.jsonl`), "utf-8")
				.length,
		).toBeGreaterThan(0);

		const reset = await manager.resetInstance(created.id);
		expect(reset.id).toBe(created.id);
		expect(reset.status).toBe("stopped");
		expect(reset.initVersion).toBeNull();
		expect(
			calls.filter((call) => call.startsWith("down:")).length,
		).toBeGreaterThan(0);
		expect(
			calls.filter((call) => call.startsWith("up:")).length,
		).toBeGreaterThan(1);
		expect(recorder.getTurnTotal(created.id)).toBe(0);
		expect(() =>
			readFileSync(join(hostConfig.dataDir, `${created.id}.jsonl`), "utf-8"),
		).toThrow();
	});

	it("uses updated compose.yaml image for newly created instances", async () => {
		const rootDir = setup();
		let hostConfig = await loadHostConfig(rootDir);
		const firstTransport = createInteractiveTransport();
		const firstManager = createInstanceManager({
			hostConfig,
			transport: firstTransport.transport,
		});
		const first = await firstManager.createInstance({
			prototype: "claude-code",
			projects: null,
		});
		expect(firstTransport.upComposeContents[0]).toContain("image: example\n");

		writeFileSync(
			join(rootDir, "prototypes", "claude-code", "compose.yaml"),
			"services:\n  agent:\n    image: example-v2\n",
		);
		hostConfig = await loadHostConfig(rootDir);
		const secondTransport = createInteractiveTransport();
		const secondManager = createInstanceManager({
			hostConfig,
			transport: secondTransport.transport,
		});
		const second = await secondManager.createInstance({
			prototype: "claude-code",
			projects: null,
		});

		expect(secondTransport.upComposeContents[0]).toContain(
			"image: example-v2\n",
		);
		expect(first.containerId).not.toBe(second.containerId);
		expect(firstManager.getInstance(first.id)?.composePath).toBe(
			second.composePath,
		);
	});

	it("generateInstanceId produces unique inst_ ids", () => {
		const a = generateInstanceId();
		const b = generateInstanceId();
		expect(a.startsWith("inst_")).toBe(true);
		expect(b.startsWith("inst_")).toBe(true);
		expect(a).not.toBe(b);
	});

	it("marks instance suspended on adapter suspend and resumes with nativeId", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const stdinWrites: Array<string> = [];
		let execCount = 0;
		const transport: Transport = {
			async up(input) {
				return { containerId: `container-${input.projectName}` };
			},
			async down() {},
			async rm() {},
			exec() {
				execCount += 1;
				const stdin = new PassThrough();
				const stdout = new PassThrough();
				stdin.on("data", (chunk: Buffer | string) => {
					const text =
						typeof chunk === "string" ? chunk : chunk.toString("utf8");
					stdinWrites.push(text);
					if (text.includes('"init"')) {
						stdout.write(`${JSON.stringify({ type: "ready", value: {} })}\n`);
					}
					if (execCount === 1 && text.includes('"message"')) {
						stdout.write(
							`${JSON.stringify({
								type: "suspend",
								value: {
									reason: "timeout",
									elapsedMs: 42,
									nativeId: "native-resume-abc",
								},
							})}\n`,
						);
						stdout.end();
					}
					if (execCount === 2 && text.includes('"message"')) {
						stdout.write(
							`${JSON.stringify({
								type: "turn",
								value: {
									index: 0,
									role: "assistant",
									content: "resumed",
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
				return {
					stdin,
					lines: rl,
					waitForExit: async () => ({ exitCode: 0, stderr: "" }),
				};
			},
			async inspectStatus() {
				return "running";
			},
		};
		const manager = createInstanceManager({ hostConfig, transport });
		const created = await manager.createInstance({
			prototype: "claude-code",
			projects: null,
		});

		const events: Array<{ event: string }> = [];
		const unsubscribe = manager.subscribeOutbox(created.id, (event) => {
			events.push({ event: event.event });
		});

		await manager.submitInbox(created.id, {
			messageId: "msg_1",
			content: "hello",
			project: null,
		});
		await waitUntil(() => events.some((event) => event.event === "suspend"));
		expect(manager.getInstance(created.id)?.status).toBe("suspended");
		expect(events.map((event) => event.event)).toEqual(["suspend"]);

		await manager.submitInbox(created.id, {
			messageId: "msg_2",
			content: "continue",
			project: null,
		});
		await waitUntil(() => events.some((event) => event.event === "done"));
		unsubscribe();

		expect(execCount).toBe(2);
		expect(manager.getInstance(created.id)?.status).toBe("running");
		const resumeWrite = stdinWrites.find((line) =>
			line.includes("native-resume-abc"),
		);
		expect(resumeWrite).toBeDefined();
		expect(events.map((event) => event.event)).toEqual([
			"suspend",
			"turn",
			"done",
		]);
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
