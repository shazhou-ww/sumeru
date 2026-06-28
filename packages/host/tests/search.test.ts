import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOcasRecorder } from "../src/ocas-recorder.js";
import { createSearchIndex } from "../src/search.js";

function writeTurn(
	dataDir: string,
	instanceId: string,
	content: string,
	index: number,
): void {
	const recorder = createOcasRecorder(dataDir);
	recorder.append(instanceId, {
		type: "turn",
		value: {
			index,
			role: "assistant",
			content,
			timestamp: "2026-06-27T00:00:00.000Z",
			toolCalls: null,
			tokens: null,
		},
	});
}

describe("createSearchIndex", () => {
	it("finds turns matching query across instances", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-search-"));
		writeTurn(dataDir, "inst_a", "hello world from alpha", 0);
		writeTurn(dataDir, "inst_b", "goodbye world from beta", 0);

		const index = createSearchIndex(dataDir);
		const hits = index.search("world", null);

		expect(hits).toHaveLength(2);
		expect(hits.map((hit) => hit.instanceId).sort()).toEqual([
			"inst_a",
			"inst_b",
		]);
	});

	it("filters by instance when instanceFilter is set", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-search-"));
		writeTurn(dataDir, "inst_a", "keyword in alpha", 0);
		writeTurn(dataDir, "inst_b", "keyword in beta", 0);

		const index = createSearchIndex(dataDir);
		const hits = index.search("keyword", "inst_a");

		expect(hits).toHaveLength(1);
		expect(hits[0]?.instanceId).toBe("inst_a");
		expect(hits[0]?.turn.value.content).toBe("keyword in alpha");
	});

	it("returns empty results for empty query", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-search-"));
		writeTurn(dataDir, "inst_a", "something", 0);

		const index = createSearchIndex(dataDir);
		expect(index.search("", null)).toEqual([]);
		expect(index.search("   ", null)).toEqual([]);
	});

	it("includes highlight substring around the match", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-search-"));
		const prefix = "x".repeat(50);
		const content = `${prefix}needle${"y".repeat(50)}`;
		writeTurn(dataDir, "inst_a", content, 0);

		const index = createSearchIndex(dataDir);
		const hits = index.search("needle", null);

		expect(hits).toHaveLength(1);
		expect(hits[0]?.highlight).toContain("needle");
		expect(hits[0]?.highlight.startsWith("…")).toBe(true);
		expect(hits[0]?.highlight.endsWith("…")).toBe(true);
	});

	it("matches case-insensitively", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-search-"));
		writeTurn(dataDir, "inst_a", "Hello WORLD", 0);

		const index = createSearchIndex(dataDir);
		const hits = index.search("world", null);

		expect(hits).toHaveLength(1);
	});
});
