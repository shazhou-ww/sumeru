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
	upProjectPaths: Array<string | null>;
	inboxProjects: Array<string | null>;
} {
	const calls: Array<string> = [];
	const upComposeContents: Array<string> = [];
	const upProjectPaths: Array<string | null> = [];
	const inboxProjects: Array<string | null> = [];
	const transport: Transport = {
		async up(input) {
			calls.push(`up:${input.projectName}`);
			upComposeContents.push(readFileSync(input.composePath, "utf-8"));
			upProjectPaths.push(input.projectPath);
			return { containerId: `container-${input.projectName}` };
		},
		async upFromImage(input) {
			calls.push(`upFromImage:${input.containerName}`);
			upProjectPaths.push(input.projectPath);
			return { containerId: `container-${input.containerName}` };
		},
		async down(input) {
			calls.push(`down:${input.projectName}`);
		},
		async rm(input) {
			calls.push(`rm:${input.projectName}`);
		},
		async rmContainer(containerId) {
			calls.push(`rmContainer:${containerId}`);
		},
		async stop(containerId) {
			calls.push(`stop:${containerId}`);
		},
		async start(containerId) {
			calls.push(`start:${containerId}`);
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
					for (const line of text.split("\n")) {
						if (line.length === 0 || !line.includes('"message"')) continue;
						try {
							const envelope = JSON.parse(line) as {
								type: string;
								value: { project: string | null };
							};
							if (envelope.type === "message") {
								inboxProjects.push(envelope.value.project);
							}
						} catch {
							// ignore partial lines
						}
					}
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
		async runOnce({ command }) {
			return {
				stdout: `ran:${command.join(" ")}`,
				stderr: "",
				exitCode: 0,
			};
		},
		async commit() {
			return { imageId: "sha256:mock-image" };
		},
	};
	return { transport, calls, upComposeContents, upProjectPaths, inboxProjects };
}

function createBlockingTransport(): Transport {
	const transport: Transport = {
		async up(input) {
			return { containerId: `container-${input.projectName}` };
		},
		async upFromImage(input) {
			return { containerId: `container-${input.containerName}` };
		},
		async down() {},
		async rm() {},
		async rmContainer() {},
		async stop() {},
		async start() {},
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
		async runOnce() {
			return { stdout: "", stderr: "", exitCode: 0 };
		},
		async commit() {
			return { imageId: "sha256:mock-image" };
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
			createPersona: (input: { name: string; instructions: string }) => unknown;
			createProvider: (input: {
				name: string;
				apiType: string;
				baseUrl: string | null;
				apiKey: string;
			}) => unknown;
			upsertModel: (
				name: string,
				input: {
					provider: string;
					model: string;
					contextWindow: number | null;
					metadata: null;
				},
			) => unknown;
		};
	}): void {
		hostConfig.sqliteStore.createProvider({
			name: "test-provider",
			apiType: "anthropic",
			baseUrl: null,
			apiKey: "sk-test",
		});
		hostConfig.sqliteStore.upsertModel("default-model", {
			provider: "test-provider",
			model: "claude-sonnet-4",
			contextWindow: null,
			metadata: null,
		});
		hostConfig.sqliteStore.createPersona({
			name: "default-persona",
			instructions: "You are a worker.",
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
		const { transport, upProjectPaths, inboxProjects } =
			createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		await manager.createSession(createSessionBody({ project: "demo" }));
		expect(upProjectPaths[0]).toBe("/tmp/workspaces/demo");
		expect(inboxProjects[0]).toBe("/workspace");
	});

	it("accepts absolute project paths under workspaceRoot", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, upProjectPaths, inboxProjects } =
			createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		await manager.createSession(
			createSessionBody({ project: "/tmp/workspaces/demo" }),
		);
		expect(upProjectPaths[0]).toBe("/tmp/workspaces/demo");
		expect(inboxProjects[0]).toBe("/workspace");
	});

	it("allows null project with no volume mount path", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, upProjectPaths, inboxProjects } =
			createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await manager.createSession(
			createSessionBody({ project: null }),
		);
		expect(created.project).toBeNull();
		expect(created.projectPath).toBeNull();
		expect(upProjectPaths[0]).toBeNull();
		expect(inboxProjects[0]).toBeNull();
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

	it("restores persisted sessions as idle after host restart (#252)", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, calls } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await manager.createSession(
			createSessionBody({ task: null }),
		);
		await waitUntil(() => manager.getSession(created.id)?.status === "idle");
		const upCallsBeforeRestart = calls.filter((call) =>
			call.startsWith("up:"),
		).length;

		const restarted = createSessionManager({ hostConfig, transport });
		const restored = restarted.getSession(created.id);
		expect(restored).not.toBeNull();
		expect(restored?.status).toBe("idle");
		expect(restored?.containerId).toBe(created.containerId);
		expect(restored?.prototype).toBe("claude-code");
		expect(restarted.listSessions()).toHaveLength(1);

		calls.length = 0;
		await restarted.submitMessage(created.id, {
			messageId: "msg_restart_test",
			content: "resume after restart",
			env: null,
			model: null,
		});
		await waitUntil(() => restarted.getSession(created.id)?.status === "idle");
		expect(calls.some((call) => call.startsWith("start:"))).toBe(false);
		expect(calls.some((call) => call.startsWith("exec:"))).toBe(true);
		expect(upCallsBeforeRestart).toBe(1);
		expect(calls.filter((call) => call.startsWith("up:")).length).toBe(0);
	});

	it("creates session with task=null → idle without sending message", async () => {
		const rootDir = setup();
		const hostConfig = await loadHostConfig(rootDir);
		seedDb(hostConfig);
		const { transport, calls } = createInteractiveTransport();
		const manager = createSessionManager({ hostConfig, transport });

		const created = await manager.createSession(
			createSessionBody({ task: null }),
		);
		expect(created.task).toBeNull();
		expect(created.status).toBe("idle");
		// Container should be up (adapter ready)
		expect(calls.some((call) => call.startsWith("up:"))).toBe(true);
		// Adapter exec started (for adapter process), but no running slot held
		const sessions = manager.listSessions();
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.status).toBe("idle");
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
			const assistantTurnEvent = manager
				.getSseBuffer(session.id)
				.eventsAfter(0)
				.filter((event) => event.event === "turn")
				.map((event) => JSON.parse(event.data) as Turn)
				.find((turn) => turn.role === "assistant");
			if (assistantTurnEvent === undefined) continue;
			turnContents.set(session.id, assistantTurnEvent.content);
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
		expect(events.map((event) => event.event)).toEqual([
			"turn",
			"turn",
			"exit",
		]);
		expect(JSON.parse(events[1]?.data ?? "{}")).toMatchObject({
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
		const turnEvents = manager
			.getSseBuffer(created.id)
			.eventsAfter(0)
			.filter((event) => event.event === "turn");
		const assistantTurnEvent = turnEvents.find((event) => {
			const data = JSON.parse(event.data) as Turn;
			return data.role === "assistant";
		});
		const turn = JSON.parse(assistantTurnEvent?.data ?? "{}") as Turn;
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
			async upFromImage(input) {
				return { containerId: `container-${input.containerName}` };
			},
			async down() {},
			async rm() {},
			async rmContainer() {},
			async stop() {},
			async start() {},
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
			async runOnce() {
				return { stdout: "", stderr: "", exitCode: 0 };
			},
			async commit() {
				return { imageId: "sha256:mock-image" };
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
		expect(events.map((event) => event.event)).toEqual([
			"turn",
			"turn",
			"exit",
		]);
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
		expect(turns).toHaveLength(2);
		expect(turns[0]?.role).toBe("user");
		expect(turns[0]?.id).toBe(0);
		expect(turns[1]?.role).toBe("assistant");
		expect(turns[1]?.id).toBe(1);

		const after = manager.getSessionTurns(created.id, 1);
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
