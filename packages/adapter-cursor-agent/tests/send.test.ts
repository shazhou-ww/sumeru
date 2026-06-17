import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

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
		const ref = await adapter.createSession({});
		return { adapter, ref, calls, sessionId };
	}

	it("returns AgentResponse with new turns", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		const response = await adapter.send(ref, "What files exist?");
		expect(response.turns.length).toBeGreaterThan(0);
		expect(response.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("returns token usage from result line", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		const response = await adapter.send(ref, "hello");
		expect(response.tokens).not.toBeNull();
		expect(response.tokens?.input).toBe(100);
		expect(response.tokens?.output).toBe(50);
	});

	it("includes --resume flag with the nativeId", async () => {
		const { adapter, ref, calls, sessionId } = await setupAdapterWithSession();
		await adapter.send(ref, "follow-up");
		const sendCall = calls[1];
		expect(sendCall).toBeDefined();
		expect(sendCall?.args).toContain("--resume");
		const resumeIdx = sendCall?.args.indexOf("--resume") ?? -1;
		expect(sendCall?.args[resumeIdx + 1]).toBe(sessionId);
	});

	it("rewrites turn indices to be globally monotonic", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		await adapter.send(ref, "message 1");
		await adapter.send(ref, "message 2");
		const allTurns = await adapter.getTurns(ref);
		for (let i = 1; i < allTurns.length; i++) {
			expect(allTurns[i]?.index).toBeGreaterThan(allTurns[i - 1]?.index);
		}
	});

	it("accumulates turns across multiple sends", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		const initialTurns = await adapter.getTurns(ref);
		const initialCount = initialTurns.length;
		await adapter.send(ref, "message 1");
		const afterFirst = await adapter.getTurns(ref);
		expect(afterFirst.length).toBeGreaterThan(initialCount);
		await adapter.send(ref, "message 2");
		const afterSecond = await adapter.getTurns(ref);
		expect(afterSecond.length).toBeGreaterThan(afterFirst.length);
	});

	it("serializes concurrent sends on the same ref (mutex)", async () => {
		const order: number[] = [];
		let resolveFirst: (() => void) | null = null;
		const { spawnFn } = fakeSpawn(async (_args, idx) => {
			if (idx === 0) {
				return {
					stdout: buildNdjson({ sessionId: "mutex-test" }),
				};
			}
			if (idx === 1) {
				// First send — delay it
				await new Promise<void>((r) => {
					resolveFirst = r;
				});
				order.push(1);
				return {
					stdout: buildNdjson({
						sessionId: "mutex-test",
						assistantText: "first",
					}),
				};
			}
			order.push(2);
			return {
				stdout: buildNdjson({
					sessionId: "mutex-test",
					assistantText: "second",
				}),
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({});

		const p1 = adapter.send(ref, "first");
		const p2 = adapter.send(ref, "second");

		// Let first resolve
		await new Promise((r) => setTimeout(r, 10));
		resolveFirst?.();

		await Promise.all([p1, p2]);
		// Second should have waited for first to complete
		expect(order).toEqual([1, 2]);
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
		const ref1 = await adapter.createSession({});
		const ref2 = await adapter.createSession({});
		// Both sends should complete (no deadlock)
		await Promise.all([
			adapter.send(ref1, "hello"),
			adapter.send(ref2, "world"),
		]);
		// 2 createSession + 2 send = 4 total calls
		expect(callCount).toBe(4);
	});

	it("rejects on a closed ref", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		await adapter.close(ref);
		await expect(adapter.send(ref, "anything")).rejects.toThrow(/is closed/);
	});

	it("rejects on null ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.send(null as never, "anything")).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("rejects on empty nativeId ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(
			adapter.send({ nativeId: "", meta: {} }, "anything"),
		).rejects.toThrow(/invalid NativeSessionRef/);
	});

	it("rejects on empty content", async () => {
		const { adapter, ref } = await setupAdapterWithSession();
		await expect(adapter.send(ref, "")).rejects.toThrow(
			/content must be a non-empty string/,
		);
	});

	it("rejects with timeout error", async () => {
		const sessionId = "timeout-session";
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildNdjson({ sessionId }) };
			}
			return { stdout: "", timedOut: true };
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({});
		await expect(adapter.send(ref, "hello")).rejects.toThrow(/timed out/);
	});

	it("rejects with session-not-found error", async () => {
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
		const ref = await adapter.createSession({});
		await expect(adapter.send(ref, "hello")).rejects.toThrow(/not found/);
	});

	it("rejects with unparseable error when stdout is garbage", async () => {
		const sessionId = "unparse-session";
		const { spawnFn } = fakeSpawn((_args, idx) => {
			if (idx === 0) {
				return { stdout: buildNdjson({ sessionId }) };
			}
			return { stdout: "not json at all\n" };
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({});
		await expect(adapter.send(ref, "hello")).rejects.toThrow(/unparseable/);
	});
});
