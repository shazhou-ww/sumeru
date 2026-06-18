import type { NativeSessionRef, SendEvent, Turn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn, fakeStreamingSpawn } from "./test-utils.js";

/** Collect all events from an AsyncIterable<SendEvent>. */
async function collectEvents(
	iter: AsyncIterable<SendEvent>,
): Promise<SendEvent[]> {
	const events: SendEvent[] = [];
	for await (const event of iter) {
		events.push(event);
	}
	return events;
}

/** Extract turns from collected events. */
function extractTurns(events: SendEvent[]): Turn[] {
	return events
		.filter((e): e is Extract<SendEvent, { type: "turn" }> => e.type === "turn")
		.map((e) => e.turn);
}

/** Extract the done event from collected events. */
function extractDone(
	events: SendEvent[],
): Extract<SendEvent, { type: "done" }> | undefined {
	return events.find(
		(e): e is Extract<SendEvent, { type: "done" }> => e.type === "done",
	);
}

/** Extract the error event from collected events. */
function extractError(
	events: SendEvent[],
): Extract<SendEvent, { type: "error" }> | undefined {
	return events.find(
		(e): e is Extract<SendEvent, { type: "error" }> => e.type === "error",
	);
}

/** Drain the iterable to force the full stream to execute. */
async function drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// consume all events
	}
}

describe("createClaudeCodeAdapter().send()", () => {
	it("spawns claude with --resume <nativeId> and parses delta turns", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({
				sessionId: "sess-resume",
				userText: "init",
				assistantText: "ack",
			}),
		});
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-resume",
				userText: "magic word?",
				assistantText: "taro",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "magic word?"));

		expect(calls.length).toBe(1);
		const sendArgs = calls[0]?.args ?? [];
		expect(sendArgs[0]).toBe("-p");
		expect(sendArgs[1]).toBe("magic word?");
		expect(sendArgs).toContain("--resume");
		expect(sendArgs[sendArgs.indexOf("--resume") + 1]).toBe("sess-resume");
		const turns = extractTurns(events);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns.some((t) => t.role === "assistant")).toBe(true);
	});

	it("rewrites delta indices to be globally monotonic (highWater + 1, +2, …)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({
				sessionId: "sess-mono",
				userText: "init",
				assistantText: "ack",
			}),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-mono",
				userText: "next",
				assistantText: "later",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const initialTurns = await adapter.getTurns(ref);
		const initialMaxIndex = initialTurns.reduce(
			(m, t) => (t.index > m ? t.index : m),
			-1,
		);
		const events = await collectEvents(adapter.send(ref, "next"));
		const turns = extractTurns(events);
		expect(turns[0]?.index).toBe(initialMaxIndex + 1);
		// Strictly monotonic across delta.
		for (let i = 1; i < turns.length; i++) {
			const a = turns[i - 1];
			const b = turns[i];
			expect(b !== undefined && a !== undefined && b.index > a.index).toBe(
				true,
			);
		}
	});

	it("appends delta turns to the in-memory cache (getTurns reflects union)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-cache" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-cache",
				userText: "more",
				assistantText: "again",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const before = await adapter.getTurns(ref);
		const events = await collectEvents(adapter.send(ref, "more"));
		const deltaTurns = extractTurns(events);
		const after = await adapter.getTurns(ref);
		expect(after.length).toBe(before.length + deltaTurns.length);
		// No overlapping indices.
		const allIdx = after.map((t) => t.index);
		expect(new Set(allIdx).size).toBe(allIdx.length);
	});

	it("two parallel sends on the same ref are serialized via per-nativeId mutex", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-mutex" }),
		});
		let inflight = 0;
		let maxInflight = 0;
		const { streamingSpawnFn } = fakeStreamingSpawn(async () => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await new Promise<void>((r) => setTimeout(r, 20));
			inflight--;
			return {
				stdout: buildNdjson({
					sessionId: "sess-mutex",
					userText: "x",
					assistantText: "y",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await Promise.all([
			drain(adapter.send(ref, "a")),
			drain(adapter.send(ref, "b")),
		]);
		expect(maxInflight).toBe(1);
	});

	it("throws synchronously when the ref is closed", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-closed" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await adapter.close(ref);
		expect(() => adapter.send(ref, "anything")).toThrow(/sess-closed.*closed/);
	});

	it("throws synchronously on empty content", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-empty" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		expect(() => adapter.send(ref, "")).toThrow(/non-empty string/);
	});

	it("throws synchronously on invalid ref", async () => {
		const adapter = createClaudeCodeAdapter({ spawnFn: fakeSpawn({}).spawnFn });
		expect(() => adapter.send({} as NativeSessionRef, "x")).toThrow(
			/send: invalid NativeSessionRef/,
		);
	});

	it("yields error event on send timeout", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-timeout" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "",
			stderr: "",
			exitCode: null,
			timedOut: true,
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			streamingSpawnFn,
			sendTimeoutMs: 100,
		});
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "x"));
		const error = extractError(events);
		expect(error).toBeDefined();
		expect(error?.error.message).toMatch(/send timed out after 100ms/);
	});

	it("error_max_turns mid-conversation yields the partial turns and done event", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-cap" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-cap",
				userText: "more",
				assistantText: "I tried...",
				subtype: "error_max_turns",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "more"));
		const turns = extractTurns(events);
		const done = extractDone(events);
		expect(turns.length).toBeGreaterThan(0);
		expect(done).toBeDefined();
	});

	it("returns durationMs measured from spawn start to exit (wall-clock)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-dur" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn(async () => {
			await new Promise<void>((r) => setTimeout(r, 30));
			return {
				stdout: buildNdjson({
					sessionId: "sess-dur",
					userText: "x",
					assistantText: "y",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "x"));
		const done = extractDone(events);
		expect(done).toBeDefined();
		expect(done?.durationMs).toBeGreaterThanOrEqual(20);
	});

	it("aggregates tokens from result.usage", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-tok" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-tok",
				userText: "x",
				assistantText: "y",
				usage: { input_tokens: 100, output_tokens: 25 },
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "x"));
		const done = extractDone(events);
		expect(done).toBeDefined();
		expect(done?.tokens?.input).toBe(100);
		expect(done?.tokens?.output).toBe(25);
	});

	it("pins the resume spawn cwd to ref.meta.cwd from create time (issue #54)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-cwd-pin" }),
		});
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-cwd-pin",
				userText: "again",
				assistantText: "ok",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({
			model: null,
			cwd: "/srv/projects/x",
		});
		await collectEvents(adapter.send(ref, "again"));
		expect(calls.length).toBe(1);
		expect(calls[0]?.cwd).toBe("/srv/projects/x");
		expect(calls[0]?.args).not.toContain("--cwd");
	});
});
