import type { SendEvent } from "@sumeru/core";
import { describe, expect, it } from "vitest";
import { createCodexAdapter } from "../src/index.js";
import { buildJsonl, fakeSpawn } from "./test-utils.js";

/** Drain the iterable (consume all events, discard results). */
async function _drain(iter: AsyncIterable<SendEvent>): Promise<void> {
	for await (const _ of iter) {
		// discard
	}
}

describe("createCodexAdapter().close()", () => {
	it("close(ref) resolves without error", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-close" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		await expect(adapter.close(ref)).resolves.toBeUndefined();
	});

	it("send(ref, content) after close(ref) throws synchronously", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-close-send" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		await adapter.close(ref);

		expect(() => adapter.send(ref, "hi")).toThrow(/is closed/);
	});

	it("getTurns(ref) after close(ref) returns the cached history", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-close-turns" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		const turnsBefore = await adapter.getTurns(ref);
		await adapter.close(ref);
		const turnsAfter = await adapter.getTurns(ref);

		expect(turnsAfter).toEqual(turnsBefore);
		expect(turnsAfter.length).toBeGreaterThan(0);
	});

	it("close(ref) twice does not throw (idempotent)", async () => {
		const { spawnFn } = fakeSpawn({
			stdout: buildJsonl({ sessionId: "sess-close-twice" }),
		});
		const adapter = createCodexAdapter({ spawnFn });
		const ref = await adapter.createSession({ model: null, cwd: null });

		await adapter.close(ref);
		await expect(adapter.close(ref)).resolves.toBeUndefined();
	});

	it("close({ nativeId: '' }) throws 'invalid NativeSessionRef'", async () => {
		const adapter = createCodexAdapter();
		await expect(adapter.close({ nativeId: "", meta: {} })).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});

	it("close(null) throws 'invalid NativeSessionRef'", async () => {
		const adapter = createCodexAdapter();
		await expect(adapter.close(null as never)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
	});
});
