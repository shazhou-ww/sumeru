import { describe, expect, it, vi } from "vitest";
import type { SpawnFn, TurnsReader } from "../src/index.js";
import { createHermesAdapter } from "../src/index.js";

const NATIVE = "20260613_120000_bbbbbb";

const turnsFixture: TurnsReader = async () => [
	{
		index: 0,
		role: "user",
		content: "hi",
		timestamp: "2026-06-13T12:00:00.000Z",
		toolCalls: null,
	},
	{
		index: 1,
		role: "assistant",
		content: "yo",
		timestamp: "2026-06-13T12:00:01.000Z",
		toolCalls: null,
	},
];

const noopSpawn: SpawnFn = async () => ({
	stdout: "",
	stderr: "",
	exitCode: 0,
	signal: null,
	timedOut: false,
	durationMs: 0,
});

describe("@sumeru/adapter-hermes — close", () => {
	it("close → subsequent send rejects with 'is closed'", async () => {
		const adapter = createHermesAdapter({
			spawnFn: noopSpawn,
			turnsReader: turnsFixture,
		});
		const ref = { nativeId: NATIVE, meta: {} };
		await adapter.close(ref);
		await expect(adapter.send(ref, "x")).rejects.toThrow(/is closed/);
	});

	it("close → getTurns still works", async () => {
		const adapter = createHermesAdapter({
			spawnFn: noopSpawn,
			turnsReader: turnsFixture,
		});
		const ref = { nativeId: NATIVE, meta: {} };
		await adapter.close(ref);
		const turns = await adapter.getTurns(ref);
		expect(turns.length).toBe(2);
	});

	it("close is idempotent", async () => {
		const adapter = createHermesAdapter({
			spawnFn: noopSpawn,
			turnsReader: turnsFixture,
		});
		const ref = { nativeId: NATIVE, meta: {} };
		await adapter.close(ref);
		await expect(adapter.close(ref)).resolves.toBeUndefined();
	});

	it("close does not spawn hermes", async () => {
		const spawnFn = vi.fn(noopSpawn);
		const adapter = createHermesAdapter({
			spawnFn,
			turnsReader: turnsFixture,
		});
		await adapter.close({ nativeId: NATIVE, meta: {} });
		expect(spawnFn).not.toHaveBeenCalled();
	});

	it("close rejects on malformed input", async () => {
		const adapter = createHermesAdapter({
			spawnFn: noopSpawn,
			turnsReader: turnsFixture,
		});
		// @ts-expect-error — intentional null
		await expect(adapter.close(null)).rejects.toThrow(
			/invalid NativeSessionRef/,
		);
		// @ts-expect-error — intentional missing nativeId
		await expect(adapter.close({})).rejects.toThrow(/invalid NativeSessionRef/);
	});

	it("scope is per-adapter (a fresh adapter does not see closed)", async () => {
		const a1 = createHermesAdapter({
			spawnFn: noopSpawn,
			turnsReader: turnsFixture,
		});
		const ref = { nativeId: NATIVE, meta: {} };
		await a1.close(ref);
		const a2 = createHermesAdapter({
			spawnFn: noopSpawn,
			turnsReader: turnsFixture,
		});
		// a2 does NOT consider it closed: send proceeds and returns delta turns
		const result = await a2.send(ref, "again");
		expect(Array.isArray(result.turns)).toBe(true);
	});
});
