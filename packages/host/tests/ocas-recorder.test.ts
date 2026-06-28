import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	chainHeadVarName,
	createOcasRecorder,
	openOcasStore,
	readChain,
} from "../src/ocas-recorder.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

function tmpDataDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

function assistantTurn(index: number, content: string) {
	return {
		type: "turn" as const,
		value: {
			index,
			role: "assistant" as const,
			content,
			timestamp: "2026-06-27T00:00:00.000Z",
			toolCalls: null,
			tokens: null,
		},
	};
}

describe("createOcasRecorder", () => {
	it("appends frames as CAS nodes and reads turn records with real hashes", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		const h0 = recorder.append("inst_test", assistantTurn(0, "hello"));
		recorder.append("inst_test", {
			type: "done",
			value: { summary: "ok", tokenUsage: null },
		});
		const h1 = recorder.append("inst_test", assistantTurn(1, "second"));

		expect(h0).toMatch(HASH_RE);
		expect(h1).toMatch(HASH_RE);

		expect(recorder.getTurnTotal("inst_test")).toBe(2);
		const turns = recorder.getTurns("inst_test", 100, 0);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.value.content).toBe("hello");
		expect(turns[1]?.value.content).toBe("second");
		expect(turns[0]?.hash).toBe(h0);
		expect(turns[1]?.hash).toBe(h1);
		expect(turns[0]?.hash).toMatch(HASH_RE);
	});

	it("links every appended node to its predecessor via prev", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		recorder.append("inst_test", assistantTurn(0, "a"));
		recorder.append("inst_test", {
			type: "done",
			value: { summary: "ok", tokenUsage: null },
		});
		recorder.append("inst_test", assistantTurn(1, "b"));

		const handle = openOcasStore(dataDir);
		try {
			const chain = readChain(handle.store, "inst_test");
			expect(chain).toHaveLength(3);
			expect(chain[0]?.payload.prev).toBeNull();
			expect(chain[1]?.payload.prev).toBe(chain[0]?.hash);
			expect(chain[2]?.payload.prev).toBe(chain[1]?.hash);
			expect(chain.map((entry) => entry.payload.type)).toEqual([
				"turn",
				"done",
				"turn",
			]);
		} finally {
			handle.close();
		}
	});

	it("tracks the chain head pointer and updates it on append", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		recorder.append("inst_test", assistantTurn(0, "a"));
		const last = recorder.append("inst_test", assistantTurn(1, "b"));

		const handle = openOcasStore(dataDir);
		try {
			const head = handle.store.var.get(chainHeadVarName("inst_test"));
			expect(head?.value).toBe(last);
		} finally {
			handle.close();
		}
	});

	it("records user inbox turns separately from outbox frames", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		recorder.append("inst_test", {
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
		recorder.append("inst_test", assistantTurn(1, "assistant reply"));

		const turns = recorder.getTurns("inst_test", 100, 0);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.value.role).toBe("user");
		expect(turns[0]?.value.content).toBe("user says hi");
		expect(turns[1]?.value.role).toBe("assistant");
	});

	it("paginates turn records with limit and offset", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		for (let index = 0; index < 5; index += 1) {
			recorder.append("inst_test", assistantTurn(index, `turn-${index}`));
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

	it("isolates chains across instances", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		recorder.append("inst_a", assistantTurn(0, "alpha"));
		recorder.append("inst_b", assistantTurn(0, "beta"));
		recorder.append("inst_b", assistantTurn(1, "beta-2"));

		expect(recorder.getTurnTotal("inst_a")).toBe(1);
		expect(recorder.getTurnTotal("inst_b")).toBe(2);
		expect(recorder.getTurns("inst_a", 10, 0)[0]?.value.content).toBe("alpha");
	});

	it("clear drops the head pointer so history resets to empty", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);

		recorder.append("inst_test", assistantTurn(0, "hello"));
		expect(recorder.getTurnTotal("inst_test")).toBe(1);

		recorder.clear("inst_test");
		expect(recorder.getTurnTotal("inst_test")).toBe(0);
		expect(recorder.getTurns("inst_test", 10, 0)).toEqual([]);

		const handle = openOcasStore(dataDir);
		try {
			expect(handle.store.var.get(chainHeadVarName("inst_test"))).toBeNull();
		} finally {
			handle.close();
		}
	});

	it("returns empty results for unknown instances", () => {
		const dataDir = tmpDataDir();
		const recorder = createOcasRecorder(dataDir);
		expect(recorder.getTurnTotal("inst_missing")).toBe(0);
		expect(recorder.getTurns("inst_missing", 10, 0)).toEqual([]);
	});
});
