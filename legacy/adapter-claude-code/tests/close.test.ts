import type { NativeSessionRef, SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createClaudeCodeAdapter } from "../src/index.js";
import { buildNdjson, fakeSpawn, fakeStreamingSpawn } from "./test-utils.js";

/** Drain the iterable to force the full stream to execute. */
async function _drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// consume all events
	}
}

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

describe("createClaudeCodeAdapter().close()", () => {
	it("is idempotent", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-close-idem" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await expect(adapter.close(ref)).resolves.toBeUndefined();
		await expect(adapter.close(ref)).resolves.toBeUndefined();
	});

	it("does not spawn anything", async () => {
		// Build adapter with a spawnFn that records its calls; close should never fire.
		const initRecord = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-no-spawn" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn: initRecord.spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const callsBefore = initRecord.calls.length;
		await adapter.close(ref);
		expect(initRecord.calls.length).toBe(callsBefore);
	});

	it("does NOT mutate the cache", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-keep-turns" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const before = await adapter.getTurns(ref);
		await adapter.close(ref);
		const after = await adapter.getTurns(ref);
		expect(after).toEqual(before);
	});

	it("subsequent send throws synchronously with closed error", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-closed-send" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await adapter.close(ref);
		expect(() => adapter.send(ref, "x")).toThrow(/sess-closed-send.*closed/);
	});

	it("getTurns still works after close", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-read-after-close" }),
		});
		const adapter = createClaudeCodeAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
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

	it("close+concurrent send: send iterable returned before close yields error when consumed after close", async () => {
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
		const ref = await adapter.createSession({ model: null, cwd: null });
		// Synchronous pre-checks pass — returns the iterable before close.
		const iter = adapter.send(ref, "concurrent");
		// Close before the generator body runs (iteration hasn't started).
		await adapter.close(ref);
		// Generator body re-checks closed state inside the lock and yields error.
		const events = await collectEvents(iter);
		const errEvt = events.find((e) => e.type === "error");
		expect(errEvt).toBeDefined();
		if (errEvt?.type === "error") {
			expect(errEvt.error.message).toMatch(/sess-race.*closed/);
		}
		// Next send must throw synchronously with closed.
		expect(() => adapter.send(ref, "next")).toThrow(/sess-race.*closed/);
	});

	it("closed-ref Set is per-adapter-instance", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-multi-instance" }),
		});
		// send() drives the streaming spawn path — inject a fake so adapter2's
		// real send does not shell out to the `claude` binary (which is absent
		// in CI and would surface as `spawn claude ENOENT`).
		const { streamingSpawnFn } = fakeStreamingSpawn({
			stdout: buildNdjson({
				sessionId: "sess-multi-instance",
				assistantText: "ok",
			}),
		});
		const adapter1 = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const adapter2 = createClaudeCodeAdapter({ spawnFn, streamingSpawnFn });
		const ref = await adapter1.createSession({ model: null, cwd: null });
		await adapter1.close(ref);
		// adapter2 has no closed-ref state for this id, so send is allowed
		// (it goes through and would spawn — verify by checking it doesn't
		// throw the "closed" error specifically).
		const events = await collectEvents(adapter2.send(ref, "anything"));
		expect(events.length).toBeGreaterThan(0);
	});
});
