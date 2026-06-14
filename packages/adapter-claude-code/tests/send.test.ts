import type { NativeSessionRef } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

async function _makeRef(
	adapter: ReturnType<typeof createClaudeCodeAdapter>,
	_sessionId: string,
): Promise<NativeSessionRef> {
	return adapter.createSession({ initialQuery: "init" });
}

describe("createClaudeCodeAdapter().send()", () => {
	it("spawns claude with --resume <nativeId> and parses delta turns", async () => {
		let phase = 0;
		const { calls, spawnFn } = fakeSpawn(() => {
			if (phase === 0) {
				phase = 1;
				return {
					stdout: buildNdjson({
						sessionId: "sess-resume",
						userText: "init",
						assistantText: "ack",
					}),
				};
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-resume",
					userText: "magic word?",
					assistantText: "taro",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "init" });
		const r1 = await adapter.send(ref, "magic word?");

		// First call (createSession) and second call (send) — verify the second.
		expect(calls.length).toBe(2);
		const sendArgs = calls[1]?.args ?? [];
		expect(sendArgs[0]).toBe("-p");
		expect(sendArgs[1]).toBe("magic word?");
		expect(sendArgs).toContain("--resume");
		expect(sendArgs[sendArgs.indexOf("--resume") + 1]).toBe("sess-resume");
		expect(r1.turns.length).toBeGreaterThan(0);
		expect(r1.turns.some((t) => t.role === "assistant")).toBe(true);
	});

	it("rewrites delta indices to be globally monotonic (highWater + 1, +2, …)", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return {
					stdout: buildNdjson({
						sessionId: "sess-mono",
						userText: "init",
						assistantText: "ack",
					}),
				};
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-mono",
					userText: "next",
					assistantText: "later",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "init" });
		const initialTurns = await adapter.getTurns(ref);
		const initialMaxIndex = initialTurns.reduce(
			(m, t) => (t.index > m ? t.index : m),
			-1,
		);
		const r1 = await adapter.send(ref, "next");
		expect(r1.turns[0]?.index).toBe(initialMaxIndex + 1);
		// Strictly monotonic across delta.
		for (let i = 1; i < r1.turns.length; i++) {
			const a = r1.turns[i - 1];
			const b = r1.turns[i];
			expect(b !== undefined && a !== undefined && b.index > a.index).toBe(
				true,
			);
		}
	});

	it("appends delta turns to the in-memory cache (getTurns reflects union)", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-cache" }) };
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-cache",
					userText: "more",
					assistantText: "again",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const before = await adapter.getTurns(ref);
		const r1 = await adapter.send(ref, "more");
		const after = await adapter.getTurns(ref);
		expect(after.length).toBe(before.length + r1.turns.length);
		// No overlapping indices.
		const allIdx = after.map((t) => t.index);
		expect(new Set(allIdx).size).toBe(allIdx.length);
	});

	it("two parallel sends on the same ref are serialized via per-nativeId mutex", async () => {
		let inflight = 0;
		let maxInflight = 0;
		const { spawnFn } = fakeSpawn(async (_args, callIdx) => {
			if (callIdx === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-mutex" }) };
			}
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
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await Promise.all([adapter.send(ref, "a"), adapter.send(ref, "b")]);
		expect(maxInflight).toBe(1);
	});

	it("rejects when the ref is closed", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-closed" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.close(ref);
		await expect(adapter.send(ref, "anything")).rejects.toThrow(
			/sess-closed.*closed/,
		);
	});

	it("rejects on empty content", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-empty" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await expect(adapter.send(ref, "")).rejects.toThrow(/non-empty string/);
	});

	it("rejects on invalid ref", async () => {
		const adapter = createClaudeCodeAdapter({ spawnFn: fakeSpawn({}).spawnFn });
		await expect(adapter.send({} as NativeSessionRef, "x")).rejects.toThrow(
			/send: invalid NativeSessionRef/,
		);
	});

	it("rejects on send timeout", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-timeout" }) };
			}
			return { stdout: "", stderr: "", exitCode: null, timedOut: true };
		});
		const adapter = createClaudeCodeAdapter({
			spawnFn,
			sendTimeoutMs: 100,
		});
		const ref = await adapter.createSession({});
		await expect(adapter.send(ref, "x")).rejects.toThrow(
			/send timed out after 100ms/,
		);
	});

	it("error_max_turns mid-conversation resolves with the partial turns", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-cap" }) };
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-cap",
					userText: "more",
					assistantText: "I tried...",
					subtype: "error_max_turns",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const r = await adapter.send(ref, "more");
		expect(r.turns.length).toBeGreaterThan(0);
	});

	it("returns durationMs measured from spawn start to exit (wall-clock)", async () => {
		const _phase = 0;
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
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const r = await adapter.send(ref, "x");
		expect(r.durationMs).toBeGreaterThanOrEqual(20);
	});

	it("aggregates tokens from result.usage", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-tok" }) };
			}
			return {
				stdout: buildNdjson({
					sessionId: "sess-tok",
					userText: "x",
					assistantText: "y",
					usage: { input_tokens: 100, output_tokens: 25 },
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const r = await adapter.send(ref, "x");
		expect(r.tokens?.input).toBe(100);
		expect(r.tokens?.output).toBe(25);
	});
});
