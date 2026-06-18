import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import { buildJsonl, fakeSpawn, fakeStreamingSpawn } from "./test-utils.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Collect all events from the async iterable. */
async function collectEvents(
	iter: AsyncIterable<SendEvent>,
): Promise<SendEvent[]> {
	const events: SendEvent[] = [];
	for await (const event of iter) {
		events.push(event);
	}
	return events;
}

/** Extract the error event from the stream. */
async function extractError(iter: AsyncIterable<SendEvent>) {
	const events = await collectEvents(iter);
	const err = events.find(
		(e): e is Extract<SendEvent, { type: "error" }> => e.type === "error",
	);
	return err ?? null;
}

/** Drain the iterable (consume all events, discard results). */
async function drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// discard
	}
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("createCodexAdapter().send()", () => {
	it("spawns codex with resume and yields delta turns + done", async () => {
		const sessionId = "sess-send-test";
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId, userText: "init" }),
		});
		const { calls, streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildJsonl({
				sessionId,
				userText: "follow-up",
				assistantText: "continued",
			}),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const events = await collectEvents(adapter.send(ref, "follow-up"));

		expect(calls.length).toBe(1);
		// Check the send call uses resume
		expect(calls[0]?.args[0]).toBe("exec");
		expect(calls[0]?.args[1]).toBe("resume");
		expect(calls[0]?.args[2]).toBe(sessionId);
		expect(calls[0]?.args[3]).toBe("follow-up");

		const turns = events.filter((e) => e.type === "turn");
		const done = events.find((e) => e.type === "done");
		expect(turns.length).toBeGreaterThan(0);
		expect(done).toBeDefined();
		expect(done?.type).toBe("done");
		if (done?.type === "done") {
			expect(typeof done.durationMs).toBe("number");
		}
	});

	it("yields turn events followed by a done event", async () => {
		const sessionId = "sess-events-order";
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildJsonl({
				sessionId,
				userText: "hello",
				assistantText: "reply",
			}),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const events = await collectEvents(adapter.send(ref, "hello"));
		const turnEvents = events.filter((e) => e.type === "turn");
		const doneEvents = events.filter((e) => e.type === "done");

		expect(turnEvents.length).toBeGreaterThan(0);
		expect(doneEvents.length).toBe(1);
		// done is last
		expect(events[events.length - 1]?.type).toBe("done");
	});

	it("throws synchronously when ref is null/undefined/invalid", () => {
		const adapter = createCodexAdapter();
		expect(() => adapter.send(null as never, "hi")).toThrow(
			/invalid NativeSessionRef/,
		);
		expect(() => adapter.send(undefined as never, "hi")).toThrow(
			/invalid NativeSessionRef/,
		);
		expect(() => adapter.send({ nativeId: "", meta: {} }, "hi")).toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("throws synchronously when content is empty or not a string", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-empty" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		expect(() => adapter.send(ref, "")).toThrow(/non-empty string/);
		expect(() => adapter.send(ref, 123 as never)).toThrow(/non-empty string/);
	});

	it("throws synchronously when session is closed", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-closed" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await adapter.close(ref);

		expect(() => adapter.send(ref, "hi")).toThrow(/is closed/);
	});

	it("yields error event on send timeout", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-timeout" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "",
			timedOut: true,
			exitCode: null,
		});
		const adapter = createCodexAdapter({
			spawnFn,
			streamingSpawnFn,
			sendTimeoutMs: 50,
		});
		const ref = await adapter.createSession({ model: null, cwd: null });

		const err = await extractError(adapter.send(ref, "hi"));
		expect(err).not.toBeNull();
		expect(err?.error.message).toMatch(/send timed out/);
	});

	it("yields done event when stdout has no turns (empty output)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-unparse" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: "not json at all",
			exitCode: 0,
		});
		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const events = await collectEvents(adapter.send(ref, "hi"));
		// With streaming, malformed lines are skipped, no error on exit code 0
		const done = events.find((e) => e.type === "done");
		expect(done).toBeDefined();
	});

	it("rewrites turn indices to be globally monotonic", async () => {
		const sessionId = "sess-indices";
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildJsonl({
				sessionId,
				userText: "msg-2",
				assistantText: "reply-2",
			}),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const initialTurns = await adapter.getTurns(ref);
		const initialIndices = initialTurns.map((t) => t.index);

		await drain(adapter.send(ref, "second"));
		const afterFirst = await adapter.getTurns(ref);
		const afterFirstIndices = afterFirst.map((t) => t.index);

		// All indices should be unique and monotonically increasing
		const allUnique =
			new Set(afterFirstIndices).size === afterFirstIndices.length;
		expect(allUnique).toBe(true);

		// New indices should be greater than previous max
		const maxInitial = Math.max(...initialIndices);
		const minNew = Math.min(
			...afterFirstIndices.filter((i) => !initialIndices.includes(i)),
		);
		expect(minNew).toBeGreaterThan(maxInitial);
	});

	it("serializes concurrent sends on the same session", async () => {
		const sessionId = "sess-mutex";
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId }),
		});
		let inflight = 0;
		let maxInflight = 0;
		const { streamingSpawnFn } = fakeStreamingSpawn(async () => {
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await new Promise<void>((r) => setTimeout(r, 10));
			inflight--;
			return {
				stdout: buildJsonl({ sessionId, assistantText: "reply" }),
			};
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		await Promise.all([
			drain(adapter.send(ref, "first")),
			drain(adapter.send(ref, "second")),
		]);

		expect(maxInflight).toBe(1);
	});

	it("returns tokens from parsed result in done event", async () => {
		const sessionId = "sess-tokens";
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildJsonl({
				sessionId,
				userText: "hi",
				usage: { input_tokens: 100, output_tokens: 50 },
			}),
		});

		const adapter = createCodexAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "hi"));
		const done = events.find(
			(e): e is Extract<SendEvent, { type: "done" }> => e.type === "done",
		);

		expect(done).toBeDefined();
		expect(done?.tokens).not.toBeNull();
		expect(done?.tokens?.input).toBe(100);
		expect(done?.tokens?.output).toBe(50);
	});
});
