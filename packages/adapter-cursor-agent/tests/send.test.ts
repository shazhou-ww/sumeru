import type { SendEvent, Turn } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

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

describe("send", () => {
	async function setupAdapterWithSession(
		spawnResults?: Parameters<typeof fakeSpawn>[0],
	) {
		const sessionId = "send-test-session-001";
		let _callCount = 0;
		const { calls, spawnFn } = fakeSpawn((args, idx) => {
			_callCount++;
			if (idx === 0) {
				// createSession call
				return {
					stdout: buildNdjson({
						sessionId,
						assistantText: "Session created",
					}),
				};
			}
			// send calls
			if (typeof spawnResults === "function") {
				return spawnResults(args, idx);
			}
			return {
				stdout: buildNdjson({
					sessionId,
					assistantText: `Response ${idx}`,
					usage: { inputTokens: 100, outputTokens: 50 },
				}),
				...(typeof spawnResults === "object" ? spawnResults : {}),
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({ model: null, cwd: null });
		return { adapter, ref, calls, sessionId };
	}

	it("yields turn events with new turns", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		const events = await collectEvents(adapter.send(ref, "What files exist?"));
		const turns = extractTurns(events);
		expect(turns.length).toBeGreaterThan(0);
		const done = extractDone(events);
		expect(done).toBeDefined();
		expect(done?.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("returns token usage from result line", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		const events = await collectEvents(adapter.send(ref, "hello"));
		const done = extractDone(events);
		expect(done).toBeDefined();
		expect(done?.tokens).not.toBeNull();
		expect(done?.tokens?.input).toBe(100);
		expect(done?.tokens?.output).toBe(50);
	});

	it("includes --resume flag with the nativeId", async () => {
		const { adapter, ref, calls, sessionId } = await setupAdapterWithSession();
		await drain(adapter.send(ref, "follow-up"));
		const sendCall = calls[1];
		expect(sendCall).toBeDefined();
		expect(sendCall?.args).toContain("--resume");
		const resumeIdx = sendCall?.args.indexOf("--resume") ?? -1;
		expect(sendCall?.args[resumeIdx + 1]).toBe(sessionId);
	});

	it("rewrites turn indices to be globally monotonic", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		await drain(adapter.send(ref, "message 1"));
		await drain(adapter.send(ref, "message 2"));
		const allTurns = await adapter.getTurns(ref);
		for (let i = 1; i < allTurns.length; i++) {
			expect(allTurns[i]?.index).toBeGreaterThan(allTurns[i - 1]?.index);
		}
	});

	it("accumulates turns across multiple sends", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		const initialTurns = await adapter.getTurns(ref);
		const initialCount = initialTurns.length;
		await drain(adapter.send(ref, "message 1"));
		const afterFirst = await adapter.getTurns(ref);
		expect(afterFirst.length).toBeGreaterThan(initialCount);
		await drain(adapter.send(ref, "message 2"));
		const afterSecond = await adapter.getTurns(ref);
		expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
	});

	it("serializes concurrent sends on the same ref (mutex)", async () => {
		let inflight = 0;
		let maxInflight = 0;
		const { spawnFn } = fakeSpawn(async (_args, idx) => {
			if (idx === 0) {
				return {
					stdout: buildNdjson({ sessionId: "mutex-test" }),
				};
			}
			inflight++;
			maxInflight = Math.max(maxInflight, inflight);
			await new Promise<void>((r) => setTimeout(r, 20));
			inflight--;
			return {
				stdout: buildNdjson({
					sessionId: "mutex-test",
					userText: "x",
					assistantText: "y",
				}),
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({ model: null, cwd: null });

		await Promise.all([
			drain(adapter.send(ref, "first")),
			drain(adapter.send(ref, "second")),
		]);
		expect(maxInflight).toBe(1);
	});

	it("allows concurrent sends on different refs", async () => {
		let callCount = 0;
		const { spawnFn } = fakeSpawn((_args, idx) => {
			callCount++;
			const id = idx < 2 ? `session-${idx}` : `session-${idx % 2}`;
			return {
				stdout: buildNdjson({ sessionId: id, assistantText: `resp ${idx}` }),
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref1 = await adapter.createSession({ model: null, cwd: null });
		const ref2 = await adapter.createSession({ model: null, cwd: null });
		// Both sends should complete (no deadlock)
		await Promise.all([
			drain(adapter.send(ref1, "hello")),
			drain(adapter.send(ref2, "world")),
		]);
		// 2 createSession + 2 send = 4 total calls
		expect(callCount).toBe(4);
	});

	it("throws synchronously on a closed ref", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		await adapter.close(ref);
		expect(() => adapter.send(ref, "anything")).toThrow(/is closed/);
	});

	it("throws synchronously on null ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		expect(() => adapter.send(null as never, "anything")).toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("throws synchronously on empty nativeId ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		expect(() => adapter.send({ nativeId: "", meta: {} }, "anything")).toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("throws synchronously on empty content", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		expect(() => adapter.send(ref, "")).toThrow(
			/content must be a non-empty string/,
		);
	});

	it("yields error event on timeout", async () => {
		const sessionId = "timeout-session";
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildNdjson({ sessionId }) };
			}
			return { stdout: "", timedOut: true };
		});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			cwd: "/workspace",
			sendTimeoutMs: 100,
		});
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "hello"));
		const error = extractError(events);
		expect(error).toBeDefined();
		expect(error?.error.message).toMatch(/send timed out after 100ms/);
	});

	it("yields error event on session-not-found", async () => {
		const sessionId = "notfound-session";
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildNdjson({ sessionId }) };
			}
			return {
				stdout: "",
				stderr: "Error: session not found",
				exitCode: 1,
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "hello"));
		const error = extractError(events);
		expect(error).toBeDefined();
		expect(error?.error.message).toMatch(/not found/);
	});

	it("yields error event when stdout is garbage (unparseable)", async () => {
		const sessionId = "unparse-session";
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildNdjson({ sessionId }) };
			}
			return { stdout: "not json at all\n" };
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "hello"));
		const error = extractError(events);
		expect(error).toBeDefined();
		expect(error?.error.message).toMatch(/unparseable/);
	});

	it("returns durationMs measured from spawn start to exit (wall-clock)", async () => {
		const { spawnFn } = fakeSpawn(async (_args, ci) => {
			if (ci === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-dur" }) };
			}
			await new Promise<void>((r) => setTimeout(r, 30));
			return {
				stdout: buildNdjson({
					sessionId: "sess-dur",
					userText: "x",
					assistantText: "y",
				}),
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const events = await collectEvents(adapter.send(ref, "x"));
		const done = extractDone(events);
		expect(done).toBeDefined();
		expect(done?.durationMs).toBeGreaterThanOrEqual(20);
	});
});
