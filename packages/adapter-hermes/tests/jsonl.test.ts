import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTurnsFromJsonl } from "../src/jsonl.js";

const FIXTURE_DIR = join(__dirname, "fixtures", "sessions");

describe("@sumeru/adapter-hermes — readTurnsFromJsonl", () => {
	it("returns null when the file does not exist", async () => {
		const turns = await readTurnsFromJsonl(FIXTURE_DIR, "20260101_000000_nope");
		expect(turns).toBeNull();
	});

	it("returns [] when the file exists but has only session_meta (no turns)", async () => {
		const turns = await readTurnsFromJsonl(FIXTURE_DIR, "20260614_empty");
		expect(turns).toEqual([]);
	});

	it("parses a v0.15.1-style file, filtering session_meta and indexing from 0", async () => {
		const turns = await readTurnsFromJsonl(FIXTURE_DIR, "20260614_jsonl_only");
		expect(turns).not.toBeNull();
		if (turns === null) return;
		// 4 turn-shaped rows (user, assistant, assistant-with-tool-calls, tool)
		expect(turns.length).toBe(4);
		expect(turns[0].index).toBe(0);
		expect(turns[0].role).toBe("user");
		expect(turns[0].content).toBe("hi");
		expect(turns[1].role).toBe("assistant");
		expect(turns[1].content).toBe("hello there");
		// tool-call-only assistant row: content was null → ""
		expect(turns[2].role).toBe("assistant");
		expect(turns[2].content).toBe("");
		expect(turns[2].toolCalls).not.toBeNull();
		if (turns[2].toolCalls !== null) {
			expect(turns[2].toolCalls[0].tool).toBe("terminal");
			expect(turns[2].toolCalls[0].input).toEqual({ command: "echo hi" });
		}
		// `tool` rows are normalized to assistant per spec
		expect(turns[3].role).toBe("assistant");
	});

	it("normalizes ISO timestamps without trailing Z", async () => {
		const turns = await readTurnsFromJsonl(FIXTURE_DIR, "20260614_jsonl_only");
		expect(turns).not.toBeNull();
		if (turns === null) return;
		for (const turn of turns) {
			expect(/Z$/.test(turn.timestamp)).toBe(true);
		}
	});

	it("never sets per-turn token usage (JSONL has none)", async () => {
		const turns = await readTurnsFromJsonl(FIXTURE_DIR, "20260614_jsonl_only");
		expect(turns).not.toBeNull();
		if (turns === null) return;
		for (const turn of turns) {
			expect(turn.tokens).toBeNull();
		}
	});

	it("skips a single malformed line and continues parsing", async () => {
		const turns = await readTurnsFromJsonl(
			FIXTURE_DIR,
			"20260614_with_bad_line",
		);
		expect(turns).not.toBeNull();
		if (turns === null) return;
		expect(turns.length).toBe(2);
		expect(turns[0].role).toBe("user");
		expect(turns[0].content).toBe("after-bad-line");
		expect(turns[1].role).toBe("assistant");
	});

	it("returns null when every non-blank line is malformed (fall-through)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sumeru-jsonl-allbad-"));
		const file = join(dir, "20260614_allbad.jsonl");
		writeFileSync(file, "not json 1\nnot json 2\nnot json 3\n", "utf-8");
		const turns = await readTurnsFromJsonl(dir, "20260614_allbad");
		expect(turns).toBeNull();
	});

	it("returns [] when the file is empty (0 bytes)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sumeru-jsonl-empty-"));
		const file = join(dir, "20260614_zero.jsonl");
		writeFileSync(file, "", "utf-8");
		const turns = await readTurnsFromJsonl(dir, "20260614_zero");
		expect(turns).toEqual([]);
	});
});
