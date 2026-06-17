import { describe, expect, it } from "vitest";
import { createCursorAgentAdapter } from "../src/adapter.js";
import { fakeSpawn } from "./test-utils.js";

describe("close", () => {
	it("resolves void on valid ref", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		const result = await adapter.close(ref);
		expect(result).toBeUndefined();
	});

	it("send after close rejects", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.close(ref);
		await expect(adapter.send(ref, "hello")).rejects.toThrow(/is closed/);
	});

	it("getTurns after close still works", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({});
		await adapter.close(ref);
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBeGreaterThan(0);
	});

	it("double close is idempotent", async () => {
		const { spawnFn } = fakeSpawn({});
		const adapter = createCursorAgentAdapter({ spawnFn });
		const ref = await adapter.createSession({});
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
});
