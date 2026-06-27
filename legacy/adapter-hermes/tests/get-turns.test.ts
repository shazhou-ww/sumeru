import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHermesAdapter } from "../src/index.js";

const NATIVE = "20260613_120000_cccccc";
const NATIVE_OTHER = "20260613_130000_dddddd";

function emptySessionsDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-hermes-sessions-empty-"));
}

function setupV1Db(): string {
	// Use Node 22's native sqlite to build a fixture DB on the fly so the
	// adapter has a real schema-v1 store to read.
	const sqlite = require("node:sqlite") as typeof import("node:sqlite");
	const dir = mkdtempSync(join(tmpdir(), "sumeru-hermes-fixture-"));
	const dbPath = join(dir, "sessions.db");
	const db = new sqlite.DatabaseSync(dbPath);
	db.exec(
		"CREATE TABLE messages (session_id TEXT, idx INTEGER, role TEXT, content TEXT, timestamp TEXT, tool_calls_json TEXT, tokens_in INTEGER, tokens_out INTEGER)",
	);
	const insert = db.prepare(
		"INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	);
	insert.run(
		NATIVE,
		0,
		"user",
		"hi",
		"2026-06-13T12:00:00.000Z",
		null,
		null,
		null,
	);
	insert.run(
		NATIVE,
		1,
		"assistant",
		"hello",
		"2026-06-13T12:00:01.000Z",
		null,
		3,
		5,
	);
	insert.run(
		NATIVE,
		2,
		"assistant",
		"used a tool",
		"2026-06-13T12:00:02.000Z",
		JSON.stringify([
			{
				tool: "terminal",
				input: { cmd: "echo hi" },
				output: "hi\n",
				durationMs: 12,
				exitCode: 0,
			},
		]),
		1,
		2,
	);
	// system row that should be filtered by default
	insert.run(
		NATIVE,
		3,
		"system",
		"sys note",
		"2026-06-13T12:00:03.000Z",
		null,
		null,
		null,
	);
	insert.run(
		NATIVE_OTHER,
		0,
		"user",
		"q",
		"2026-06-13T13:00:00.000Z",
		null,
		null,
		null,
	);
	db.close();
	return dbPath;
}

function setupV2Db(sessionId: string): string {
	// uwf-shaped DB: sessions + messages, ordered by id ASC.
	const sqlite = require("node:sqlite") as typeof import("node:sqlite");
	const dir = mkdtempSync(join(tmpdir(), "sumeru-hermes-v2-"));
	const dbPath = join(dir, "state.db");
	const db = new sqlite.DatabaseSync(dbPath);
	db.exec(
		"CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, started_at INTEGER, input_tokens INTEGER, output_tokens INTEGER)",
	);
	db.exec(
		"CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, reasoning TEXT, tool_calls TEXT)",
	);
	db.prepare(
		"INSERT INTO sessions (id, model, started_at, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)",
	).run(sessionId, "anthropic/claude-haiku-4", 1717200000, 0, 0);
	const msg = db.prepare(
		"INSERT INTO messages (session_id, role, content, reasoning, tool_calls) VALUES (?, ?, ?, ?, ?)",
	);
	msg.run(sessionId, "user", "from db", null, null);
	msg.run(sessionId, "assistant", "db answer", null, null);
	msg.run(
		sessionId,
		"assistant",
		"",
		null,
		JSON.stringify([
			{ function: { name: "terminal", arguments: '{"command":"ls"}' } },
		]),
	);
	msg.run(sessionId, "tool", "{}", null, null);
	db.close();
	return dbPath;
}

describe("@sumeru/adapter-hermes — getTurns (fixture DB)", () => {
	it("returns turns ordered by index, mapping toolCalls and tokens (schema v1)", async () => {
		const dbPath = setupV1Db();
		const adapter = createHermesAdapter({
			dbPath,
			sessionsDir: emptySessionsDir(),
		});
		const turns = await adapter.getTurns({ nativeId: NATIVE, meta: {} });
		// system row filtered by default
		expect(turns.map((t) => t.index)).toEqual([0, 1, 2]);
		expect(turns[0].role).toBe("user");
		expect(turns[0].content).toBe("hi");
		expect(turns[0].toolCalls).toBeNull();
		expect(turns[1].tokens).toEqual({ input: 3, output: 5 });
		expect(turns[2].toolCalls).toEqual([
			{
				tool: "terminal",
				input: { cmd: "echo hi" },
				output: "hi\n",
				durationMs: 12,
				exitCode: 0,
			},
		]);
	});

	it("returns [] for an unknown nativeId (not an error)", async () => {
		const dbPath = setupV1Db();
		const adapter = createHermesAdapter({
			dbPath,
			sessionsDir: emptySessionsDir(),
		});
		const turns = await adapter.getTurns({
			nativeId: "20260101_000000_ffffff",
			meta: {},
		});
		expect(turns).toEqual([]);
	});

	it("returns [] when both JSONL and DB are missing (no error)", async () => {
		const adapter = createHermesAdapter({
			dbPath: "/tmp/__definitely_missing__.db",
			sessionsDir: emptySessionsDir(),
		});
		const turns = await adapter.getTurns({ nativeId: NATIVE, meta: {} });
		expect(turns).toEqual([]);
	});

	it("rejects with schema-mismatch error when required column is absent (v1)", async () => {
		const sqlite = require("node:sqlite") as typeof import("node:sqlite");
		const dir = mkdtempSync(join(tmpdir(), "sumeru-hermes-bad-"));
		const dbPath = join(dir, "sessions.db");
		const db = new sqlite.DatabaseSync(dbPath);
		// missing 'idx' column
		db.exec(
			"CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp TEXT)",
		);
		db.close();
		const adapter = createHermesAdapter({
			dbPath,
			sessionsDir: emptySessionsDir(),
		});
		await expect(
			adapter.getTurns({ nativeId: NATIVE, meta: {} }),
		).rejects.toThrow(/schema mismatch.*idx.*v1/);
	});

	it("rejects with 'unreadable' on corrupt DB", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sumeru-hermes-corrupt-"));
		const dbPath = join(dir, "sessions.db");
		writeFileSync(dbPath, "this is not sqlite content");
		const adapter = createHermesAdapter({
			dbPath,
			sessionsDir: emptySessionsDir(),
		});
		await expect(
			adapter.getTurns({ nativeId: NATIVE, meta: {} }),
		).rejects.toThrow(/unreadable|schema mismatch/);
	});

	// New: JSONL-first precedence

	it("reads from JSONL when present (DB is ignored)", async () => {
		const sessionsDir = join(__dirname, "fixtures", "sessions");
		// dbPath intentionally invalid: if it were consulted, the test would
		// fail with an error rather than a clean turn list.
		const adapter = createHermesAdapter({
			dbPath: "/tmp/__never_read__.db",
			sessionsDir,
		});
		const turns = await adapter.getTurns({
			nativeId: "20260614_jsonl_only",
			meta: {},
		});
		expect(turns.length).toBeGreaterThanOrEqual(2);
		expect(turns.some((t) => t.role === "user")).toBe(true);
		expect(turns.some((t) => t.role === "assistant")).toBe(true);
	});

	it("prefers JSONL over DB when both exist (DB driver never called)", async () => {
		const sessionsDir = join(__dirname, "fixtures", "sessions");
		const dbCalls: number[] = [];
		const adapter = createHermesAdapter({
			dbPath: "/tmp/__should_not_read__.db",
			sessionsDir,
			turnsReader: async () => {
				dbCalls.push(1);
				return [];
			},
		});
		const turns = await adapter.getTurns({
			nativeId: "20260614_jsonl_and_db",
			meta: {},
		});
		expect(dbCalls.length).toBe(0);
		expect(turns.length).toBeGreaterThan(0);
		expect(turns[0].role).toBe("user");
		expect(turns[0].content).toBe("from jsonl");
	});

	it("falls back to uwf-shaped (v2) DB when JSONL is absent", async () => {
		const sessionId = "20260614_db_only";
		const dbPath = setupV2Db(sessionId);
		const adapter = createHermesAdapter({
			dbPath,
			sessionsDir: emptySessionsDir(),
		});
		const turns = await adapter.getTurns({ nativeId: sessionId, meta: {} });
		expect(turns.length).toBe(4);
		expect(turns[0].role).toBe("user");
		expect(turns[0].content).toBe("from db");
		expect(turns[0].index).toBe(0);
		expect(turns[1].role).toBe("assistant");
		expect(turns[2].toolCalls).not.toBeNull();
		if (turns[2].toolCalls !== null) {
			expect(turns[2].toolCalls[0].tool).toBe("terminal");
			expect(turns[2].toolCalls[0].input).toEqual({ command: "ls" });
		}
		// `tool` row was normalized to assistant
		expect(turns[3].role).toBe("assistant");
	});

	it("uwf-shaped DB with unknown session id resolves to [] (not error)", async () => {
		const dbPath = setupV2Db("20260614_db_only");
		const adapter = createHermesAdapter({
			dbPath,
			sessionsDir: emptySessionsDir(),
		});
		const turns = await adapter.getTurns({
			nativeId: "20260101_000000_aaaaaa",
			meta: {},
		});
		expect(turns).toEqual([]);
	});

	// Opt-in integration: read turns from a real Hermes session DB.
	// Skipped by default — set SUMERU_HERMES_INTEGRATION=1 to run.
	it.skipIf(process.env.SUMERU_HERMES_INTEGRATION !== "1")(
		"reads turns from a live Hermes session",
		async () => {
			const adapter = createHermesAdapter({});
			const sessionRef = await adapter.createSession({
				model: "anthropic/claude-haiku-4",
			});
			try {
				await adapter.send(sessionRef, "Say hi briefly.");
				const turns = await adapter.getTurns(sessionRef);
				expect(turns.length).toBeGreaterThanOrEqual(1);
				expect(turns.every((t) => typeof t.index === "number")).toBe(true);
				expect(turns.some((t) => t.role === "assistant")).toBe(true);
			} finally {
				await adapter.close(sessionRef);
			}
		},
		90_000,
	);
});
