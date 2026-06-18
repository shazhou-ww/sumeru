import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import { buildJsonl, fakeSpawn } from "./test-utils.js";

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

/** Extract only the turn events from the stream. */
async function _extractTurns(iter: AsyncIterable<SendEvent>) {
	const events = await collectEvents(iter);
	return events
		.filter((e): e is Extract<SendEvent, { type: "turn" }> => e.type === "turn")
		.map((e) => e.turn);
}

/** Extract the done event from the stream (expects exactly one). */
async function extractDone(iter: AsyncIterable<SendEvent>) {
	const events = await collectEvents(iter);
	const done = events.find(
		(e): e is Extract<SendEvent, { type: "done" }> => e.type === "done",
	);
	return done ?? null;
}

/** Extract the error event from the stream (expects exactly one). */
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
		let callCount = 0;
		const { calls, spawnFn } = fakeSpawn(() => {
			callCount++;
			if (callCount === 1) {
				// createSession
				return { stdout: buildJsonl({ sessionId, userText: "init" }) };
			}
			// send
			return {
				stdout: buildJsonl({
					sessionId,
					userText: "follow-up",
					assistantText: "continued",
				}),
			};
		});

		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const events = await collectEvents(adapter.send(ref, "follow-up"));

		expect(calls.length).toBe(2);
		// Check the send call uses resume
		expect(calls[1]?.args[0]).toBe("exec");
		expect(calls[1]?.args[1]).toBe("resume");
		expect(calls[1]?.args[2]).toBe(sessionId);
		expect(calls[1]?.args[3]).toBe("follow-up");

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
		let callCount = 0;
		const { spawnFn } = fakeSpawn(() => {
			callCount++;
			return {
				stdout: buildJsonl({
					sessionId,
					userText: `msg-${callCount}`,
					assistantText: `reply-${callCount}`,
				}),
			};
		});

		const adapter = createCodexAdapter({ spawnFn });
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
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildJsonl({ sessionId: "sess-timeout" }) };
			}
			return { stdout: "", timedOut: true, exitCode: null };
		});
		const adapter = createCodexAdapter({ spawnFn, sendTimeoutMs: 50 });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const err = await extractError(adapter.send(ref, "hi"));
		expect(err).not.toBeNull();
		expect(err?.error.message).toMatch(/send timed out/);
	});

	it("yields error event on unparseable output", async () => {
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildJsonl({ sessionId: "sess-unparse" }) };
			}
			return { stdout: "not json at all", exitCode: 0 };
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const err = await extractError(adapter.send(ref, "hi"));
		expect(err).not.toBeNull();
		expect(err?.error.message).toMatch(/unparseable/);
	});

	it("rewrites turn indices to be globally monotonic", async () => {
		const sessionId = "sess-indices";
		let callCount = 0;
		const { spawnFn } = fakeSpawn(() => {
			callCount++;
			return {
				stdout: buildJsonl({
					sessionId,
					userText: `msg-${callCount}`,
					assistantText: `reply-${callCount}`,
				}),
			};
		});

		const adapter = createCodexAdapter({ spawnFn });
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
		let callCount = 0;
		const order: number[] = [];
		const { spawnFn } = fakeSpawn(async () => {
			const myCall = ++callCount;
			// First call is createSession
			if (myCall === 1) {
				return { stdout: buildJsonl({ sessionId }) };
			}
			// Add small delay to test serialization
			await new Promise((r) => setTimeout(r, 10));
			order.push(myCall);
			return {
				stdout: buildJsonl({
					sessionId,
					userText: `call-${myCall}`,
					assistantText: `reply-${myCall}`,
				}),
			};
		});

		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		// Fire two sends concurrently
		const [events1, events2] = await Promise.all([
			collectEvents(adapter.send(ref, "first")),
			collectEvents(adapter.send(ref, "second")),
		]);

		// Both should complete with turn events
		const turns1 = events1.filter((e) => e.type === "turn");
		const turns2 = events2.filter((e) => e.type === "turn");
		expect(turns1.length).toBeGreaterThan(0);
		expect(turns2.length).toBeGreaterThan(0);

		// The sends should have been serialized (order should be [2, 3])
		expect(order.length).toBe(2);
		expect(order[0]).toBeLessThan(order[1] ?? 0);
	});

	it("returns tokens from parsed result in done event", async () => {
		const sessionId = "sess-tokens";
		let callCount = 0;
		const { spawnFn } = fakeSpawn(() => {
			callCount++;
			return {
				stdout: buildJsonl({
					sessionId,
					userText: `msg-${callCount}`,
					usage: {
						input_tokens: 50 * callCount,
						output_tokens: 25 * callCount,
					},
				}),
			};
		});

		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const done = await extractDone(adapter.send(ref, "hi"));

		expect(done).not.toBeNull();
		expect(done?.tokens).not.toBeNull();
		expect(done?.tokens?.input).toBe(100);
		expect(done?.tokens?.output).toBe(50);
	});
});
