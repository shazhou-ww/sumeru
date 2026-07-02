import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import type { Turn } from "@sumeru/core";
import { afterEach, describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/config.js";
import { generateSessionId } from "../src/id.js";
import { createOcasRecorder } from "../src/ocas-recorder.js";
import { createSessionManager } from "../src/session-manager.js";
import type { Transport, TransportExecSession } from "../src/types.js";

function writeHostFixture(rootDir: string, maxRunning = 2): void {
	writeFileSync(
		join(rootDir, "host.yaml"),
		[
			"name: test-host",
			`maxRunning: ${maxRunning}`,
			"workspaceRoot: /tmp/workspaces",
			"envFile: /dev/null",
		].join("\n"),
	);
	mkdirSync("/tmp/workspaces/demo", { recursive: true });
	const dataDir = join(rootDir, "data");
	mkdirSync(join(dataDir, "skills"), { recursive: true });
	mkdirSync(join(dataDir, "prototypes"), { recursive: true });
	writeFileSync(
		join(dataDir, "prototypes", "claude-code.yaml"),
		[
			"name: claude-code",
			"persona: default-persona",
			"model: default-model",
			"adapter: claude-code",
		].join("\n"),
	);
	const prototypeDir = join(rootDir, "prototypes", "claude-code");
	mkdirSync(prototypeDir, { recursive: true });
	writeFileSync(join(prototypeDir, "compose.yaml"), testComposeYaml("example"));
}

const COMPOSE_PROJECT_VOLUME_MOUNT =
	"$" + "{SUMERU_PROJECT_PATH}:$" + "{SUMERU_PROJECT_PATH}";

function testComposeYaml(image: string): string {
	return [
		"services:",
		"  agent:",
		`    image: ${image}`,
		"    volumes:",
		`      - "${COMPOSE_PROJECT_VOLUME_MOUNT}"`,
	].join("\n");
}

function createSessionBody(overrides: Record<string, unknown> = {}) {
	return {
		prototype: "claude-code",
		project: "demo",
		task: "hello",
		model: null,
		env: null,
		...overrides,
	};
}

function createInteractiveTransport(): {
	transport: Transport;
	calls: Array<string>;
	upComposeContents: Array<string>;
	upProjectPaths: Array<string>;
} {
	const calls: Array<string> = [];
	const upComposeContents: Array<string> = [];
	const upProjectPaths: Array<string> = [];
	const transport: Transport = {
		async up(input) {
			calls.push(`up:${input.projectName}`);
			upComposeContents.push(readFileSync(input.composePath, "utf-8"));
			upProjectPaths.push(input.projectPath);
			return { containerId: `container-${input.projectName}` };
		},
		async down(input) {
			calls.push(`down:${input.projectName}`);
		},
		async rm(input) {
			calls.push(`rm:${input.projectName}`);
		},
		exec({ containerId, command, env: _env }) {
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
	return { transport, calls, upComposeContents, upProjectPaths };
}

function createBlockingTransport(): Transport {
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
					stdout.write(`${JSON.stringify({ type: "ready", value: {} })}\n`);
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
	return transport;
}

describe("session-manager", () => {
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

	function seedDb(hostConfig: {
		sqliteStore: {
			createPersona: (input: {
				name: string;
				instructions: string;
				skills: Array<string>;
			}) => unknown;
			createProvider: (input: {
				name: string;
				apiType: string;
				baseUrl: string | null;
				apiKey: string;
			}) => unknown;
			createModel: (input: {
				id: string;
				provider: string;
				model: string;
				contextWindow: number | null;
				toolUse: boolean;
				streaming: boolean;
				metadata: null;
			}) => unknown;
		};
	}): void {
		hostConfig.sqliteStore.createProvider({
			name: "test-provider",
			apiType: "anthropic",
			baseUrl: null,
			apiKey: "sk-test",
		});
		hostConfig.sqliteStore.createModel({
			id: "default-model",
			provider: "test-provider",
			model: "claude-sonnet-4",
			contextWindow: null,
			toolUse: true,
			streaming: true,
			metadata: null,
		});
		hostConfig.sqliteStore.createPersona({
			name: "default-persona",
			instructions: "You are a worker.",
			skills: [],
		});
	}

	it("starts with no sessions", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		const { transport } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });
		expect(manager.listSessions()).toEqual([]);
	});

	it("passes resolved projectPath into transport.up", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, upProjectPaths } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		await manager.createSession(createSessionBody({ project: "demo" }));
		expect(upProjectPaths[0]).toBe("/tmp/workspaces/demo");
	});

	it("creates and deletes docker-backed sessions", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, calls } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await manager.createSession(createSessionBody());
		expect(created.id.startsWith("ses_")).toBe(true);
		expect(created.prototype).toBe("claude-code");
		expect(created.project).toBe("demo");
		expect(created.task).toBe("hello");
		expect(created.model.apiKey).toBe("sk-test");
		expect(created.image).toBe("example");
		expect(created.containerId).toContain("container-");
		expect(created.status).toBe("running");
		expect(manager.listSessions()).toHaveLength(1);
		expect(calls.some((call) => call.startsWith("up:"))).toBe(true);

		await waitUntil(() => manager.getSession(created.id)?.status === "idle");
		await manager.deleteSession(created.id);
		expect(manager.getSession(created.id)).toBeNull();
		expect(calls.some((call) => call.startsWith("down:"))).toBe(true);
		expect(calls.some((call) => call.startsWith("rm:"))).toBe(true);
	});

	it("queues session creation in FIFO order when maxRunning is reached", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const transport = createBlockingTransport();
		const manager = createSessionManager({ hostConfig, transport });
		await manager.createSession(createSessionBody({ task: "first" }));
		await manager.createSession(createSessionBody({ task: "second" }));

		let thirdStarted = false;
		const thirdPromise = manager
			.createSession(createSessionBody({ task: "third" }))
			.then((session) => {
				thirdStarted = true;
				return session;
			});

		await sleep(100);
		expect(thirdStarted).toBe(false);

		const running = manager
			.listSessions()
			.filter((s) => s.status === "running");
		expect(running).toHaveLength(2);
		await manager.stopSession(running[0]?.id ?? "");
		const third = await thirdPromise;
		expect(third.task).toBe("third");
	});

	it("runs three sessions in parallel without shared state contamination", async () => {
		const rootDir = mkdtempSync(join(tmpdir(), "sumeru-host-"));
		tempDirs.push(rootDir);
		writeHostFixture(rootDir, 10);
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await Promise.all([
			manager.createSession(createSessionBody({ task: "hello-0" })),
			manager.createSession(createSessionBody({ task: "hello-1" })),
			manager.createSession(createSessionBody({ task: "hello-2" })),
		]);
		expect(new Set(created.map((item) => item.id)).size).toBe(3);

		await waitUntil(() =>
			created.every(
				(session) => manager.getSession(session.id)?.status === "idle",
			),
		);

		const turnContents = new Map<string, string>();
		for (const session of created) {
			const managed = manager.getSession(session.id);
			const turnEvent = manager
				.getSseBuffer(session.id)
				.eventsAfter(0)
				.find((event) => event.event === "turn");
			if (turnEvent === undefined) continue;
			const data = JSON.parse(turnEvent.data) as Turn;
			turnContents.set(session.id, data.content);
			expect(turnContents.get(session.id)).toBe(
				`pong:${managed?.projectName ?? ""}`,
			);
		}
		expect(turnContents.size).toBe(3);
		expect(new Set(turnContents.values()).size).toBe(3);
	});

	it("records turn and exit events in the events buffer during create+start", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, calls } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession(createSessionBody());

		await waitUntil(() => manager.getSession(created.id)?.status === "idle");
		const events = manager.getSseBuffer(created.id).eventsAfter(0);
		expect(calls.some((call) => call.startsWith("exec:"))).toBe(true);
		expect(events.map((event) => event.event)).toEqual(["turn", "exit"]);
		expect(JSON.parse(events[0]?.data ?? "{}")).toMatchObject({
			role: "assistant",
			content: expect.stringMatching(/^pong:/),
		});
	});

	it("emits turn events with wall-clock durationMs >= 1 and null tokenUsage (bug #178)", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession(createSessionBody());

		await waitUntil(() => manager.getSession(created.id)?.status === "idle");
		const turnEvent = manager
			.getSseBuffer(created.id)
			.eventsAfter(0)
			.find((event) => event.event === "turn");
		const turn = JSON.parse(turnEvent?.data ?? "{}") as Turn;

		if (turn.role !== "assistant") throw new Error("expected assistant turn");
		// durationMs is wall-clock, never 0, never the sum of tool durations.
		expect(Number.isInteger(turn.durationMs)).toBe(true);
		expect(turn.durationMs).toBeGreaterThanOrEqual(1);
		// The interactive transport reports tokens: null → host must surface null,
		// not a fabricated { input: 0, output: 0, cached: 0 }.
		expect(turn.tokenUsage).toBeNull();
	});

	it("stopSession transitions running to idle with stopped exit", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const transport = createBlockingTransport();
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession(
			createSessionBody({ task: "long task" }),
		);
		expect(created.status).toBe("running");
		const stopped = await manager.stopSession(created.id);
		expect(stopped.status).toBe("idle");
		expect(stopped.exit?.type).toBe("stopped");
		await expect(manager.stopSession(created.id)).rejects.toThrow(
			"session_already_idle",
		);
	});

	it("uses updated compose.yaml image for newly created sessions", async () => {
		const rootDir = setup();
		let hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const firstTransport = createInteractiveTransport();
		const firstManager = createSessionManager({
			hostConfig,
			transport: firstTransport.transport,
		});
		const first = await firstManager.createSession(createSessionBody());
		expect(firstTransport.upComposeContents[0]).toContain("image: example\n");

		writeFileSync(
			join(rootDir, "prototypes", "claude-code", "compose.yaml"),
			testComposeYaml("example-v2"),
		);
		hostConfig = await loadHostConfig(rootDir);
		const secondTransport = createInteractiveTransport();
		const secondManager = createSessionManager({
			hostConfig,
			transport: secondTransport.transport,
		});
		const second = await secondManager.createSession(createSessionBody());

		expect(secondTransport.upComposeContents[0]).toContain(
			"image: example-v2\n",
		);
		expect(first.containerId).not.toBe(second.containerId);
		expect(firstManager.getSession(first.id)?.composePath).toBe(
			second.composePath,
		);
	});

	it("generateSessionId produces unique ses_ ids", () => {
		const a = generateSessionId();
		const b = generateSessionId();
		expect(a.startsWith("ses_")).toBe(true);
		expect(b.startsWith("ses_")).toBe(true);
		expect(a).not.toBe(b);
	});

	it("marks session idle on adapter suspend and resumes on next message", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const stdinWrites: Array<string> = [];
		let execCount = 0;
		const transport: Transport = {
			async up(input) {
				return { containerId: `container-${input.projectName}` };
			},
			async down() {},
			async rm() {},
			exec(_input) {
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
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession(createSessionBody());

		await waitUntil(() => manager.getSession(created.id)?.status === "idle");
		expect(manager.getSession(created.id)?.exit?.type).toBe("timeout");
		expect(
			manager
				.getSseBuffer(created.id)
				.eventsAfter(0)
				.some((event) => event.event === "exit"),
		).toBe(true);

		const events: Array<{ event: string }> = [];
		const unsubscribe = manager.subscribeEvents(created.id, (event) => {
			events.push({ event: event.event });
		});

		await manager.submitMessage(created.id, {
			messageId: "msg_2",
			content: "continue",
			env: null,
			model: null,
		});
		await waitUntil(() => events.some((event) => event.event === "exit"));
		unsubscribe();

		expect(execCount).toBe(2);
		expect(manager.getSession(created.id)?.status).toBe("idle");
		expect(manager.getSession(created.id)?.exit?.type).toBe("complete");
		const resumeWrite = stdinWrites.find((line) =>
			line.includes("native-resume-abc"),
		);
		expect(resumeWrite).toBeUndefined();
		expect(events.map((event) => event.event)).toEqual(["turn", "exit"]);
	});

	it("clears history on delete", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport } = createInteractiveTransport();
		const recorder = createOcasRecorder(hostConfig.dataDir);
		const manager = createSessionManager({ hostConfig, transport, recorder });
		const created = await manager.createSession(createSessionBody());
		await waitUntil(() => recorder.getTurnTotal(created.id) > 0);
		await manager.deleteSession(created.id);
		expect(recorder.getTurnTotal(created.id)).toBe(0);
	});

	it("returns v3 turns from persisted session activity", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession(createSessionBody());
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");

		const turns = manager.getSessionTurns(created.id, null);
		expect(turns).toHaveLength(1);
		expect(turns[0]?.role).toBe("assistant");
		expect(turns[0]?.id).toBe(0);

		const after = manager.getSessionTurns(created.id, 0);
		expect(after).toEqual([]);
	});

	it("reports host root status counts and uptime", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const transport = createBlockingTransport();
		const manager = createSessionManager({ hostConfig, transport });
		const created = await manager.createSession(createSessionBody());

		const root = manager.hostRoot();
		expect(root.name).toBe("test-host");
		expect(root.status.running).toBe(1);
		expect(root.status.idle).toBe(0);
		expect(root.uptime).toBeGreaterThanOrEqual(0);

		await manager.stopSession(created.id);
		const idleRoot = manager.hostRoot();
		expect(idleRoot.status.running).toBe(0);
		expect(idleRoot.status.idle).toBe(1);
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
