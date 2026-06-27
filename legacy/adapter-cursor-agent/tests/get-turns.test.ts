import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn, fakeStreamingSpawn } from "./test-utils.js";

/** Drain the iterable to force the full stream to execute. */
async function drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// consume all events
	}
}

describe("getTurns", () => {
	it("returns turns after createSession", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns.some((t) => t.role === "assistant")).toBe(true);
	});

	it("returns accumulated turns after multiple sends", async () => {
		const sessionId = "get-turns-session";
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId, assistantText: "response 1" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({ sessionId, assistantText: "response 2" }),
		});
		const adapter = createCursorAgentAdapter({
			spawnFn,
			streamingSpawnFn,
			cwd: "/workspace",
		});
		const ref = await adapter.createSession({ model: null, cwd: null });
		await drain(adapter.send(ref, "msg 1"));
		await drain(adapter.send(ref, "msg 2"));
		const turns = await adapter.getTurns(ref);
		// createSession produces 2 turns (user+assistant), each send produces 2 more
		expect(turns.length).toBe(6);
	});

	it("returns a defensive copy (mutations don't affect internal cache)", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
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
		const ref = await adapter.createSession({ model: null, cwd: null });
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
		const ref1 = await adapter1.createSession({ model: null, cwd: null });
		const ref2 = await adapter2.createSession({ model: null, cwd: null });
		// Each adapter should only see its own session
		const turns1 = await adapter1.getTurns(ref2);
		expect(turns1).toEqual([]);
		const turns2 = await adapter2.getTurns(ref1);
		expect(turns2).toEqual([]);
	});

	it("returns the union after createSession + 2 sends, with strictly monotonic indices", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-monotonic" }),
		});
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-monotonic",
				userText: "x",
				assistantText: "y",
			}),
		});
		const adapter = createCursorAgentAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await drain(adapter.send(ref, "x"));
		await drain(adapter.send(ref, "y"));
		const turns = await adapter.getTurns(ref);
		// Indices must be strictly monotonic.
		for (let i = 1; i < turns.length; i++) {
			const a = turns[i - 1];
			const b = turns[i];
			expect(b !== undefined && a !== undefined && b.index > a.index).toBe(
				true,
			);
		}
		expect(turns[0]?.index).toBe(0);
	});
});
