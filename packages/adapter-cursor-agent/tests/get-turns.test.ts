import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

describe("getTurns", () => {
	it("returns turns after createSession", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "Say hi." });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns.some((t) => t.role === "assistant")).toBe(true);
	});

	it("returns accumulated turns after multiple sends", async () => {
		const sessionId = "get-turns-session";
		let callIdx = 0;
		const { spawnFn } = fakeSpawn((_args, _idx) => {
			callIdx++;
			return {
				stdout: buildNdjson({
					sessionId,
					assistantText: `response ${callIdx}`,
				}),
			};
		});
		const adapter = createCursorAgentAdapter({ spawnFn, cwd: "/workspace" });
		const ref = await adapter.createSession({});
		await adapter.send(ref, "msg 1");
		await adapter.send(ref, "msg 2");
		const turns = await adapter.getTurns(ref);
		// createSession produces 2 turns (user+assistant), each send produces 2 more
		expect(turns.length).toBe(6);
	});

	it("returns a defensive copy (mutations don't affect internal cache)", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const turns1 = await adapter.getTurns(ref);
		const originalLength = turns1.length;
		// Mutate the returned array
		turns1.push({
			index: 999,
			role: "user",
			content: "injected",
			timestamp: "",
			toolCalls: null,
			tokens: null,
			hash: null,
		});
		// Get turns again — should not see the injected turn
		const turns2 = await adapter.getTurns(ref);
		expect(turns2.length).toBe(originalLength);
	});

	it("returns empty array for unknown nativeId", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const turns = await adapter.getTurns({
			nativeId: "nonexistent-id",
			meta: {},
		});
		expect(turns).toEqual([]);
	});

	it("works after close (close does not evict cache)", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const beforeClose = await adapter.getTurns(ref);
		await adapter.close(ref);
		const afterClose = await adapter.getTurns(ref);
		expect(afterClose.length).toBe(beforeClose.length);
	});

	it("rejects on null ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.getTurns(null as never)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("rejects on undefined ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.getTurns(undefined as never)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("rejects on empty nativeId ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.getTurns({ nativeId: "", meta: {} })).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("per-instance isolation — two adapters have independent caches", async () => {
		const sessionId1 = "iso-session-1";
		const sessionId2 = "iso-session-2";
		const _callCount = 0;
		const spawn1 = fakeSpawn(() => ({
			stdout: buildNdjson({
				sessionId: sessionId1,
				assistantText: "from adapter 1",
			}),
		}));
		const spawn2 = fakeSpawn(() => ({
			stdout: buildNdjson({
				sessionId: sessionId2,
				assistantText: "from adapter 2",
			}),
		}));
		const adapter1 = createCursorAgentAdapter({ spawnFn: spawn1.spawnFn });
		const adapter2 = createCursorAgentAdapter({ spawnFn: spawn2.spawnFn });
		const ref1 = await adapter1.createSession({});
		const ref2 = await adapter2.createSession({});
		// Each adapter should only see its own session
		const turns1 = await adapter1.getTurns(ref2);
		expect(turns1).toEqual([]);
		const turns2 = await adapter2.getTurns(ref1);
		expect(turns2).toEqual([]);
	});
});
