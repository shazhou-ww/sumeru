import type { NativeSessionRef } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

describe("createClaudeCodeAdapter().close()", () => {
	it("is idempotent", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-close-idem" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await expect(adapter.close(ref)).resolves.toBeUndefined();
		await expect(adapter.close(ref)).resolves.toBeUndefined();
	});

	it("does not spawn anything", async () => {
		// Build adapter with a spawnFn that records its calls; close should never fire.
		const initRecord = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-no-spawn" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn: initRecord.spawnFn });
		const ref = await adapter.createSession({});
		const callsBefore = initRecord.calls.length;
		await adapter.close(ref);
		expect(initRecord.calls.length).toBe(callsBefore);
	});

	it("does NOT mutate the cache", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-keep-turns" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const before = await adapter.getTurns(ref);
		await adapter.close(ref);
		const after = await adapter.getTurns(ref);
		expect(after).toEqual(before);
	});

	it("subsequent send rejects with closed error", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-closed-send" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.close(ref);
		await expect(adapter.send(ref, "x")).rejects.toThrow(
			/sess-closed-send.*closed/,
		);
	});

	it("getTurns still works after close", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-read-after-close" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.close(ref);
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
	});

	it("rejects on malformed ref", async () => {
		const adapter = createClaudeCodeAdapter({});
		await expect(
			adapter.close(null as unknown as NativeSessionRef),
		).rejects.toThrow(/close: invalid NativeSessionRef/);
		await expect(adapter.close({} as NativeSessionRef)).rejects.toThrow(
			/close: invalid NativeSessionRef/,
		);
		await expect(
			adapter.close({ nativeId: "" } as NativeSessionRef),
		).rejects.toThrow(/close: invalid NativeSessionRef/);
	});

	it("close+concurrent send: in-flight send completes; next send rejects", async () => {
		const _phase = 0;
		const { spawnFn } = fakeSpawn(async (_args, ci) => {
			if (ci === 0) {
				return { stdout: buildNdjson({ sessionId: "sess-race" }) };
			}
			await new Promise<void>((r) => setTimeout(r, 25));
			return {
				stdout: buildNdjson({
					sessionId: "sess-race",
					userText: "x",
					assistantText: "y",
				}),
			};
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const sendPromise = adapter.send(ref, "concurrent");
		// Close while send is in flight — this only marks the closed flag,
		// the in-flight send should NOT be aborted.
		await adapter.close(ref);
		const r = await sendPromise;
		expect(r.turns.length).toBeGreaterThan(0);
		// Next send must reject with closed.
		await expect(adapter.send(ref, "next")).rejects.toThrow(
			/sess-race.*closed/,
		);
	});

	it("closed-ref Set is per-adapter-instance", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-multi-instance" }),
		});
		const adapter1 = createClaudeCodeAdapter({ spawnFn });
		const adapter2 = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter1.createSession({});
		await adapter1.close(ref);
		// adapter2 has no closed-ref state for this id, so send is allowed
		// (it goes through and would spawn — verify by checking it doesn't
		// throw the "closed" error specifically).
		await expect(adapter2.send(ref, "anything")).resolves.toBeDefined();
	});
});
