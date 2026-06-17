import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import { buildJsonl, fakeSpawn } from "./test-utils.js";

describe("createCodexAdapter().send()", () => {
	it("spawns codex with resume and returns delta turns", async () => {
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
		const ref = await adapter.createSession({ initialQuery: "init" });

		const response = await adapter.send(ref, "follow-up");

		expect(calls.length).toBe(2);
		// Check the send call uses resume
		expect(calls[1]?.args[0]).toBe("exec");
		expect(calls[1]?.args[1]).toBe("resume");
		expect(calls[1]?.args[2]).toBe(sessionId);
		expect(calls[1]?.args[3]).toBe("follow-up");

		expect(response.turns.length).toBeGreaterThan(0);
		expect(typeof response.durationMs).toBe("number");
	});

	it("rejects when ref is null/undefined/invalid", async () => {
		const adapter = createCodexAdapter();
		await expect(adapter.send(null as never, "hi")).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
		await expect(adapter.send(undefined as never, "hi")).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
		await expect(
			adapter.send({ nativeId: "", meta: {} }, "hi"),
		).rejects.toThrow(/invalid NativeSessionRef/);
	});

	it("rejects when content is empty or not a string", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-empty" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({});

		await expect(adapter.send(ref, "")).rejects.toThrow(/non-empty string/);
		await expect(adapter.send(ref, 123 as never)).rejects.toThrow(
			/non-empty string/,
		);
	});

	it("rejects when session is closed", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-closed" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.close(ref);

		await expect(adapter.send(ref, "hi")).rejects.toThrow(/is closed/);
	});

	it("rejects on send timeout", async () => {
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildJsonl({ sessionId: "sess-timeout" }) };
			}
			return { stdout: "", timedOut: true, exitCode: null };
		});
		const adapter = createCodexAdapter({ spawnFn, sendTimeoutMs: 50 });
		const ref = await adapter.createSession({});

		await expect(adapter.send(ref, "hi")).rejects.toThrow(/send timed out/);
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
		const ref = await adapter.createSession({});

		const initialTurns = await adapter.getTurns(ref);
		const initialIndices = initialTurns.map((t) => t.index);

		await adapter.send(ref, "second");
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
		const ref = await adapter.createSession({});

		// Fire two sends concurrently
		const [r1, r2] = await Promise.all([
			adapter.send(ref, "first"),
			adapter.send(ref, "second"),
		]);

		// Both should complete
		expect(r1.turns.length).toBeGreaterThan(0);
		expect(r2.turns.length).toBeGreaterThan(0);

		// The sends should have been serialized (order should be [2, 3])
		expect(order.length).toBe(2);
		expect(order[0]).toBeLessThan(order[1] ?? 0);
	});

	it("returns tokens from parsed result", async () => {
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
		const ref = await adapter.createSession({});
		const response = await adapter.send(ref, "hi");

		expect(response.tokens).not.toBeNull();
		expect(response.tokens?.input).toBe(100);
		expect(response.tokens?.output).toBe(50);
	});
});
