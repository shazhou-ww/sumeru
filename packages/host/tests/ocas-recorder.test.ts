import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOcasRecorder } from "../src/ocas-recorder.js";

describe("createOcasRecorder", () => {
	it("appends outbox frames as jsonl and reads turn records", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
		const recorder = createOcasRecorder(dataDir);

		recorder.record("inst_test", {
			type: "turn",
			value: {
				index: 0,
				role: "assistant",
				content: "hello",
				timestamp: "2026-06-27T00:00:00.000Z",
				toolCalls: null,
				tokens: null,
			},
		});
		recorder.record("inst_test", {
			type: "done",
			value: { summary: "ok", tokenUsage: null },
		});
		recorder.record("inst_test", {
			type: "turn",
			value: {
				index: 1,
				role: "assistant",
				content: "second",
				timestamp: "2026-06-27T00:00:01.000Z",
				toolCalls: null,
				tokens: null,
			},
		});

		const raw = readFileSync(join(dataDir, "inst_test.jsonl"), "utf-8");
		expect(raw.split("\n").filter((line) => line.length > 0)).toHaveLength(3);

		expect(recorder.getTurnTotal("inst_test")).toBe(2);
		const turns = recorder.getTurns("inst_test", 100, 0);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.value.content).toBe("hello");
		expect(turns[1]?.value.content).toBe("second");
		expect(turns[0]?.hash).toBeNull();
	});

	it("records user inbox turns separately from outbox frames", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
		const recorder = createOcasRecorder(dataDir);

		recorder.record("inst_test", {
			type: "turn",
			value: {
				index: 0,
				role: "user",
				content: "user says hi",
				timestamp: "2026-06-27T00:00:00.000Z",
				toolCalls: null,
				tokens: null,
			},
		});
		recorder.record("inst_test", {
			type: "turn",
			value: {
				index: 1,
				role: "assistant",
				content: "assistant reply",
				timestamp: "2026-06-27T00:00:00.000Z",
				toolCalls: null,
				tokens: null,
			},
		});

		const turns = recorder.getTurns("inst_test", 100, 0);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.value.role).toBe("user");
		expect(turns[0]?.value.content).toBe("user says hi");
		expect(turns[1]?.value.role).toBe("assistant");
	});

	it("paginates turn records with limit and offset", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
		const recorder = createOcasRecorder(dataDir);

		for (let index = 0; index < 5; index += 1) {
			recorder.record("inst_test", {
				type: "turn",
				value: {
					index,
					role: "assistant",
					content: `turn-${index}`,
					timestamp: "2026-06-27T00:00:00.000Z",
					toolCalls: null,
					tokens: null,
				},
			});
		}

		expect(recorder.getTurnTotal("inst_test")).toBe(5);
		expect(
			recorder.getTurns("inst_test", 2, 0).map((turn) => turn.value.content),
		).toEqual(["turn-0", "turn-1"]);
		expect(
			recorder.getTurns("inst_test", 2, 2).map((turn) => turn.value.content),
		).toEqual(["turn-2", "turn-3"]);
		expect(
			recorder.getTurns("inst_test", 2, 4).map((turn) => turn.value.content),
		).toEqual(["turn-4"]);
		expect(recorder.getTurns("inst_test", 2, 6)).toEqual([]);
	});

	it("returns empty results for unknown instances", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
		const recorder = createOcasRecorder(dataDir);
		expect(recorder.getTurnTotal("inst_missing")).toBe(0);
		expect(recorder.getTurns("inst_missing", 10, 0)).toEqual([]);
	});
});
