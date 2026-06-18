import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { buildNdjson, fakeSpawn } from "./test-utils.js";

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

describe("close", () => {
	it("resolves void on valid ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const result = await adapter.close(ref);
		expect(result).toBeUndefined();
	});

	it("send after close throws synchronously", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await adapter.close(ref);
		expect(() => adapter.send(ref, "hello")).toThrow(/is closed/);
	});

	it("getTurns after close still works", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await adapter.close(ref);
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
	});

	it("double close is idempotent", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		await adapter.close(ref);
		await expect(adapter.close(ref)).resolves.toBeUndefined();
	});

	it("rejects on null ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.close(null as never)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("rejects on undefined ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.close(undefined as never)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("rejects on empty nativeId ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		await expect(adapter.close({ nativeId: "", meta: {} })).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("does NOT mutate the cache", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildNdjson({ sessionId: "sess-keep-turns" }),
		});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });
		const before = await adapter.getTurns(ref);
		await adapter.close(ref);
		const after = await adapter.getTurns(ref);
		expect(after).toEqual(before);
	});

	it("close+concurrent send: send iterable returned before close yields error when consumed after close", async () => {
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
		const adapter = createCursorAgentAdapter({ spawnFn });
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
		const adapter1 = createCursorAgentAdapter({ spawnFn });
		const adapter2 = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter1.createSession({ model: null, cwd: null });
		await adapter1.close(ref);
		// adapter2 has no closed-ref state for this id, so send is allowed
		const events = await collectEvents(adapter2.send(ref, "anything"));
		expect(events.length).toBeGreaterThan(0);
	});
});
