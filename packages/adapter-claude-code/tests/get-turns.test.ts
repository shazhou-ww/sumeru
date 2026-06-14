import type { NativeSessionRef } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

describe("createClaudeCodeAdapter().getTurns()", () => {
	it("returns the parsed initial Turn[] in order after createSession", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({
				sessionId: "sess-init",
				userText: "hi",
				assistantText: "hello",
			}),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ initialQuery: "hi" });
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThanOrEqual(2);
		expect(turns[0]?.role).toBe("user");
		expect(turns[0]?.content).toBe("hi");
		expect(turns[0]?.index).toBe(0);
		expect(turns[1]?.role).toBe("assistant");
		expect(turns[1]?.content).toBe("hello");
		expect(turns[1]?.index).toBe(1);
	});

	it("returns the union after createSession + 2 sends, with strictly monotonic indices", async () => {
		let phase = 0;
		const { spawnFn } = fakeSpawn(() => {
			if (phase++ === 0)
				return { stdout: buildNdjson({ sessionId: "sess-monotonic" }) };
			return {
				stdout: buildNdjson({
					sessionId: "sess-monotonic",
					userText: "x",
					assistantText: "y",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.send(ref, "x");
		await adapter.send(ref, "y");
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

	it("returns a defensive copy (mutations do not affect cache)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-defensive" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const turns1 = await adapter.getTurns(ref);
		const length1 = turns1.length;
		turns1.pop();
		const turns2 = await adapter.getTurns(ref);
		expect(turns2.length).toBe(length1);
	});

	it("returns [] for an unknown nativeId without throwing", async () => {
		const adapter = createClaudeCodeAdapter({});
		const turns = await adapter.getTurns({
			nativeId: "00000000-0000-0000-0000-000000000000",
			meta: {},
		});
		expect(turns).toEqual([]);
	});

	it("rejects on malformed ref", async () => {
		const adapter = createClaudeCodeAdapter({});
		await expect(
			adapter.getTurns(null as unknown as NativeSessionRef),
		).rejects.toThrow(/getTurns: invalid NativeSessionRef/);
		await expect(adapter.getTurns({} as NativeSessionRef)).rejects.toThrow(
			/getTurns: invalid NativeSessionRef/,
		);
	});

	it("returns the same turns after close()", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-close-readback" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const before = await adapter.getTurns(ref);
		await adapter.close(ref);
		const after = await adapter.getTurns(ref);
		expect(after).toEqual(before);
	});

	it("a second adapter instance has its own empty cache", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-instance-iso" }),
		});
		const a1 = createClaudeCodeAdapter({ spawnFn });
		const ref = await a1.createSession({});
		const a2 = createClaudeCodeAdapter({ spawnFn });
		const a2Turns = await a2.getTurns(ref);
		expect(a2Turns).toEqual([]);
		const a1Turns = await a1.getTurns(ref);
		expect(a1Turns.length).toBeGreaterThan(0);
	});
});
