import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeStreamingSpawn, loadFixture } from "./test-utils.js";

const INIT_CONFIG: AdapterInitConfig = {
	instructions: "You are a helpful assistant.",
	skills: [],
	model: { provider: "anthropic", name: "", apiKey: null },
};

async function makeHomeDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "sumeru-cursor-"));
}

/** Drain a handle() generator into { turns, done }. */
async function drainHandle(
	gen: AsyncGenerator<unknown, unknown>,
): Promise<{ turns: unknown[]; done: unknown }> {
	const turns: unknown[] = [];
	let done: unknown;
	while (true) {
		const next = await gen.next();
		if (next.done) {
			done = next.value;
			break;
		}
		turns.push(next.value);
	}
	return { turns, done };
}

describe("createCursorAgentAdapter — handle()", () => {
	it("yields turns and returns DoneValue from the result line", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);

		const gen = adapter.handle({
			messageId: "m1",
			content: "Say hi.",
			project: null,
		});
		const { turns, done } = await drainHandle(gen);

		expect(turns.length).toBe(2);
		expect((turns[0] as { role: string }).role).toBe("user");
		expect((turns[1] as { role: string }).role).toBe("assistant");
		expect(done).toEqual({
			summary: "Hello! How can I help you today?",
			tokenUsage: { input: 150, output: 25, cached: 0 },
		});
	});

	it("captures the session id and exposes it via getNativeId", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		expect(adapter.getNativeId?.() ?? null).toBeNull();

		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "hi",
				project: null,
			}),
		);
		expect(adapter.getNativeId?.()).toBe(
			"a1b2c3d4-e5f6-7890-abcd-ef1234567890",
		);
	});

	it("builds the expected argv (print / stream-json / trust / force / workspace)", async () => {
		const homeDir = await makeHomeDir();
		const projectDir = await makeHomeDir();
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);

		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "Hello world!",
				project: projectDir,
			}),
		);

		const args = calls[0]?.args;
		expect(args).toBeDefined();
		expect(args?.[0]).toBe("-p");
		expect(args?.[1]).toBe("Hello world!");
		expect(args).toContain("--print");
		expect(args).toContain("--output-format");
		expect(args).toContain("stream-json");
		expect(args).toContain("--trust");
		expect(args).toContain("--force");
		const wsIdx = args?.indexOf("--workspace") ?? -1;
		expect(wsIdx).toBeGreaterThan(-1);
		expect(args?.[wsIdx + 1]).toBe(projectDir);
	});

	it("passes --resume with the captured session id on a subsequent call", async () => {
		const homeDir = await makeHomeDir();
		const sessionId = "resume-session-001";
		const { calls, streamingSpawnFn } = fakeStreamingSpawn(() => ({
			stdout: buildNdjson({ sessionId, assistantText: "ok" }),
		}));
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);

		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "first",
				project: null,
			}),
		);
		await drainHandle(
			adapter.handle({
				messageId: "m2",
				content: "second",
				project: null,
			}),
		);

		const secondArgs = calls[1]?.args;
		expect(secondArgs).toContain("--resume");
		const resumeIdx = secondArgs?.indexOf("--resume") ?? -1;
		expect(secondArgs?.[resumeIdx + 1]).toBe(sessionId);
	});

	it("passes --model when a model is configured via options", async () => {
		const homeDir = await makeHomeDir();
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
			model: "gpt-5",
		});
		await adapter.init(INIT_CONFIG);

		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "hi",
				project: null,
			}),
		);
		const args = calls[0]?.args;
		expect(args).toContain("--model");
		expect(args).toContain("gpt-5");
	});

	it("prefers init-config model name over options model", async () => {
		const homeDir = await makeHomeDir();
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
			model: "gpt-5",
		});
		await adapter.init({
			...INIT_CONFIG,
			model: { provider: "anthropic", name: "claude-sonnet-4", apiKey: null },
		});
		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "hi",
				project: null,
			}),
		);
		const args = calls[0]?.args;
		const modelIdx = args?.indexOf("--model") ?? -1;
		expect(args?.[modelIdx + 1]).toBe("claude-sonnet-4");
	});

	it("passes --yolo when permissionMode is yolo (and not --force)", async () => {
		const homeDir = await makeHomeDir();
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
			permissionMode: "yolo",
		});
		await adapter.init(INIT_CONFIG);
		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "hi",
				project: null,
			}),
		);
		const args = calls[0]?.args;
		expect(args).toContain("--yolo");
		expect(args).not.toContain("--force");
	});

	it("passes --sandbox when sandbox is set", async () => {
		const homeDir = await makeHomeDir();
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
			sandbox: "enabled",
		});
		await adapter.init(INIT_CONFIG);
		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "hi",
				project: null,
			}),
		);
		const args = calls[0]?.args;
		expect(args).toContain("--sandbox");
		expect(args).toContain("enabled");
	});

	it("rewrites turn indices to be globally monotonic across handle calls", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn(() => ({
			stdout: buildNdjson({ sessionId: "mono-001", assistantText: "ok" }),
		}));
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);

		const { turns: first } = await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "first",
				project: null,
			}),
		);
		const { turns: second } = await drainHandle(
			adapter.handle({
				messageId: "m2",
				content: "second",
				project: null,
			}),
		);

		const all = [...first, ...second] as Array<{ index: number }>;
		for (let i = 1; i < all.length; i++) {
			expect(all[i]?.index).toBeGreaterThan(all[i - 1]?.index);
		}
		expect((first[0] as { index: number }).index).toBe(0);
	});

	it("throws when handle is called before init", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await expect(
			adapter
				.handle({
					messageId: "m1",
					content: "hi",
					project: null,
				})
				.next(),
		).rejects.toThrow(/before init/);
	});

	it("throws on empty content", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		await expect(
			adapter
				.handle({
					messageId: "m1",
					content: "",
					project: null,
				})
				.next(),
		).rejects.toThrow(/content must be a non-empty string/);
	});

	it("rejects with API key error on non-zero exit with CURSOR_API_KEY stderr", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "",
			stderr: "Error: CURSOR_API_KEY is not set",
			exitCode: 1,
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		await expect(
			drainHandle(
				adapter.handle({
					messageId: "m1",
					content: "hi",
					project: null,
				}),
			),
		).rejects.toThrow(/cursor-agent API key error/);
	});

	it("rejects with trust error on non-zero exit with trust stderr", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "",
			stderr: "Error: workspace not trusted",
			exitCode: 1,
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		await expect(
			drainHandle(
				adapter.handle({
					messageId: "m1",
					content: "hi",
					project: null,
				}),
			),
		).rejects.toThrow(/requires --trust/);
	});

	it("rejects with session-not-found on resume failure", async () => {
		const homeDir = await makeHomeDir();
		let call = 0;
		const { streamingSpawnFn } = fakeStreamingSpawn(() => {
			call++;
			if (call === 1) {
				return { stdout: buildNdjson({ sessionId: "gone-001" }) };
			}
			return {
				stdout: "",
				stderr: "Error: session not found",
				exitCode: 1,
			};
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "first",
				project: null,
			}),
		);
		await expect(
			drainHandle(
				adapter.handle({
					messageId: "m2",
					content: "second",
					project: null,
				}),
			),
		).rejects.toThrow(/not found/);
	});

	it("rejects with timeout error when timedOut is true", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
			timedOut: true,
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		await expect(
			drainHandle(
				adapter.handle({
					messageId: "m1",
					content: "hi",
					project: null,
				}),
			),
		).rejects.toThrow(/timed out/);
	});

	it("rejects with generic exit error on non-zero exit without known pattern", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "",
			stderr: "something else broke",
			exitCode: 2,
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		await expect(
			drainHandle(
				adapter.handle({
					messageId: "m1",
					content: "hi",
					project: null,
				}),
			),
		).rejects.toThrow(/exited with code 2/);
	});

	it("serializes concurrent handle calls (handle mutex)", async () => {
		const homeDir = await makeHomeDir();
		const order: number[] = [];
		let resolveFirst: (() => void) | null = null;
		const { streamingSpawnFn } = fakeStreamingSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildNdjson({ sessionId: "mutex-001" }) };
			}
			if (idx === 1) {
				// Park the first handle's line iteration until released.
				return new Promise<{ stdout: string }>((r) => {
					resolveFirst = () =>
						r({
							stdout: buildNdjson({
								sessionId: "mutex-001",
								assistantText: "first",
							}),
						});
				});
			}
			order.push(2);
			return {
				stdout: buildNdjson({
					sessionId: "mutex-001",
					assistantText: "second",
				}),
			};
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);

		// First handle to establish the session.
		await drainHandle(
			adapter.handle({ messageId: "m0", content: "boot", project: null }),
		);

		const p1 = drainHandle(
			adapter.handle({ messageId: "m1", content: "first", project: null }),
		);
		const p2 = drainHandle(
			adapter.handle({ messageId: "m2", content: "second", project: null }),
		);

		// Let the event loop tick so the first handle's line iteration is parked
		// on the blocking outcome promise, then release it.
		await new Promise((r) => setTimeout(r, 10));
		order.push(1);
		resolveFirst?.();

		await Promise.all([p1, p2]);
		// p2's spawn could not run until p1 released the handle mutex.
		expect(order).toEqual([1, 2]);
	});

	it("emits a progressive tool turn during a tool-call fixture", async () => {
		const homeDir = await makeHomeDir();
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.edit-tool.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);

		const { turns, done } = await drainHandle(
			adapter.handle({
				messageId: "m1",
				content: "create a file",
				project: null,
			}),
		);
		// user + assistant + tool + assistant
		expect(turns.length).toBe(4);
		expect((turns[2] as { role: string }).role).toBe("tool");
		expect(done).toEqual({
			summary: "Done! I've created hello.ts with a greeting export.",
			tokenUsage: { input: 300, output: 80, cached: 50 },
		});
	});

	it("handles unicode/special characters in content", async () => {
		const homeDir = await makeHomeDir();
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		const content = 'Say "hello"\nnewline	🎉';
		await drainHandle(
			adapter.handle({ messageId: "m1", content, project: null }),
		);
		expect(calls[0]?.args[1]).toBe(content);
	});

	it("init() resets sessionId to null when no prior state exists", async () => {
		const homeDir = await makeHomeDir();
		const adapter = createCursorAgentAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);
		// Runtime calls resume() before handle() on every message subcommand.
		// With no prior state, init() wrote sessionId:null, so resume() loads
		// that and native id stays null.
		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.() ?? null).toBeNull();
	});

	it("init() preserves the existing sessionId from session.json (#274)", async () => {
		const homeDir = await makeHomeDir();
		const existingSessionId = "snapshot-session-7742";
		// Seed a snapshot-style session.json with a real sessionId.
		const stateDir = join(homeDir, ".cursor-agent-adapter");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(
			join(stateDir, "session.json"),
			JSON.stringify({ sessionId: existingSessionId, initConfig: INIT_CONFIG }),
			"utf-8",
		);

		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: loadFixture("ca-stream.simple.ndjson"),
		});
		const adapter = createCursorAgentAdapter({
			streamingSpawnFn,
			homeDir,
		});
		await adapter.init(INIT_CONFIG);
		// Runtime path: resume() reloads the preserved sessionId into memory.
		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.()).toBe(existingSessionId);

		await drainHandle(
			adapter.handle({ messageId: "m1", content: "hi", project: null }),
		);

		// The spawn must include --resume <existingSessionId>, proving
		// init() preserved the snapshot sessionId rather than nulling it.
		const args = calls[0]?.args;
		expect(args).toContain("--resume");
		const resumeIdx = args?.indexOf("--resume") ?? -1;
		expect(args?.[resumeIdx + 1]).toBe(existingSessionId);
	});

	it("resume() restores the sessionId preserved by init()", async () => {
		const homeDir = await makeHomeDir();
		const existingSessionId = "snapshot-session-9988";
		const stateDir = join(homeDir, ".cursor-agent-adapter");
		mkdirSync(stateDir, { recursive: true });
		writeFileSync(
			join(stateDir, "session.json"),
			JSON.stringify({ sessionId: existingSessionId, initConfig: INIT_CONFIG }),
			"utf-8",
		);

		const adapter = createCursorAgentAdapter({ homeDir });
		await adapter.init(INIT_CONFIG);

		expect(await adapter.resume()).toBe(true);
		expect(adapter.getNativeId?.()).toBe(existingSessionId);
	});
});
