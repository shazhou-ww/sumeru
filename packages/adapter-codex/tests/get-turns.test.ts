import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import { buildJsonl, fakeSpawn } from "./test-utils.js";

describe("createCodexAdapter().getTurns()", () => {
	it("after createSession, getTurns returns the initial turns", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-get-turns" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "hi" });

		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns[0]?.role).toBe("user");
	});

	it("after send, getTurns returns initial + delta turns", async () => {
		const sessionId = "sess-get-turns-send";
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
		await adapter.send(ref, "second message");
		const afterSend = await adapter.getTurns(ref);

		expect(afterSend.length).toBeGreaterThan(initialTurns.length);
	});

	it("mutating the returned array does not affect subsequent getTurns calls", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-mutate" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({});

		const turns1 = await adapter.getTurns(ref);
		const originalLength = turns1.length;

		// Mutate the returned array
		turns1.push({
			index: 999,
			role: "user",
			content: "injected",
			timestamp: new Date().toISOString(),
			toolCalls: null,
			tokens: null,
			hash: null,
		});

		const turns2 = await adapter.getTurns(ref);
		expect(turns2.length).toBe(originalLength);
	});

	it("getTurns for an unknown nativeId returns []", async () => {
		const adapter = createCodexAdapter();
		const turns = await adapter.getTurns({
			nativeId: "unknown-session-id",
			meta: {},
		});
		expect(turns).toEqual([]);
	});

	it("getTurns({ nativeId: '' }) throws 'invalid NativeSessionRef'", async () => {
		const adapter = createCodexAdapter();
		await expect(adapter.getTurns({ nativeId: "", meta: {} })).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("getTurns(null) throws 'invalid NativeSessionRef'", async () => {
		const adapter = createCodexAdapter();
		await expect(adapter.getTurns(null as never)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});
});
