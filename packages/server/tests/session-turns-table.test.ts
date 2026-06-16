/**
 * Phase 6 — `server-session-turns-table.md` (Refs #399).
 *
 * Verifies the durable per-session turn-list table `sumeru_session_turns`,
 * the additive `meta_hash` column on `sumeru_session_index`, the guarded
 * legacy migration, the idempotent append + ordered read API, and that the
 * FTS `rebuild()` path leaves the turn-list pointer untouched.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openSumeruOcas } from "../src/index.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

type ColumnRow = { name: string; pk: number };

function columns(dbPath: string, table: string): ColumnRow[] {
	const db = new DatabaseSync(dbPath);
	const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
		name: string;
		pk: number;
	}>;
	db.close();
	return rows.map((r) => ({ name: r.name, pk: r.pk }));
}

describe("server-session-turns-table — schema presence", () => {
	it("creates sumeru_session_turns with a (session_id, turn_index) primary key", () => {
		const dir = tmpOcasDir();
		openSumeruOcas(dir);
		const dbPath = join(dir, "_store.db");

		const db = new DatabaseSync(dbPath);
		const tableRow = db
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='sumeru_session_turns'",
			)
			.get() as { name: string } | undefined;
		db.close();
		expect(tableRow?.name).toBe("sumeru_session_turns");

		const cols = columns(dbPath, "sumeru_session_turns");
		const pkCols = cols
			.filter((c) => c.pk > 0)
			.sort((a, b) => a.pk - b.pk)
			.map((c) => c.name);
		expect(pkCols).toEqual(["session_id", "turn_index"]);
		expect(cols.map((c) => c.name)).toContain("turn_hash");
	});

	it("adds a meta_hash column to sumeru_session_index", () => {
		const dir = tmpOcasDir();
		openSumeruOcas(dir);
		const cols = columns(join(dir, "_store.db"), "sumeru_session_index");
		expect(cols.map((c) => c.name)).toContain("meta_hash");
	});

	it("re-opening a fresh dir is idempotent (no throw)", () => {
		const dir = tmpOcasDir();
		openSumeruOcas(dir);
		expect(() => openSumeruOcas(dir)).not.toThrow();
	});
});

describe("server-session-turns-table — legacy migration", () => {
	it("adds meta_hash to a pre-existing sumeru_session_index without it", () => {
		const dir = tmpOcasDir();
		const dbPath = join(dir, "_store.db");

		// Hand-craft a legacy DB: sumeru_session_index WITHOUT meta_hash.
		const legacy = new DatabaseSync(dbPath);
		legacy.exec("PRAGMA journal_mode = WAL");
		legacy.exec(`
			CREATE TABLE sumeru_session_index (
			  session_id      TEXT PRIMARY KEY,
			  gateway         TEXT NOT NULL,
			  adapter         TEXT NOT NULL,
			  status          TEXT NOT NULL,
			  created_at      TEXT NOT NULL,
			  last_active_at  TEXT NOT NULL,
			  turn_count      INTEGER NOT NULL DEFAULT 0
			);
		`);
		legacy
			.prepare(
				`INSERT INTO sumeru_session_index
				   (session_id, gateway, adapter, status, created_at, last_active_at, turn_count)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				"ses_LEGACY",
				"hermes",
				"hermes",
				"idle",
				"2026-01-01T00:00:00Z",
				"2026-01-01T00:00:00Z",
				0,
			);
		legacy.close();

		// Open through the normal boot path — migration must run, not throw.
		expect(() => openSumeruOcas(dir)).not.toThrow();

		const cols = columns(dbPath, "sumeru_session_index");
		expect(cols.map((c) => c.name)).toContain("meta_hash");

		// The legacy row survives with meta_hash = NULL.
		const db = new DatabaseSync(dbPath);
		const row = db
			.prepare(
				"SELECT session_id, meta_hash FROM sumeru_session_index WHERE session_id = ?",
			)
			.get("ses_LEGACY") as { session_id: string; meta_hash: string | null };
		db.close();
		expect(row.session_id).toBe("ses_LEGACY");
		expect(row.meta_hash).toBeNull();
	});
});

describe("server-session-turns-table — append + read round-trip", () => {
	it("appendSessionTurn + listSessionTurns returns hashes in turn_index order", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		const idx = ocas.searchIndex;
		idx.appendSessionTurn("ses_A", 0, "AAAAAAAAAAAAA");
		idx.appendSessionTurn("ses_A", 1, "BBBBBBBBBBBBB");
		idx.appendSessionTurn("ses_A", 2, "CCCCCCCCCCCCC");
		expect(idx.listSessionTurns("ses_A")).toEqual([
			"AAAAAAAAAAAAA",
			"BBBBBBBBBBBBB",
			"CCCCCCCCCCCCC",
		]);
	});

	it("append is idempotent on (session_id, turn_index) — ON CONFLICT DO NOTHING", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		const idx = ocas.searchIndex;
		idx.appendSessionTurn("ses_A", 0, "AAAAAAAAAAAAA");
		idx.appendSessionTurn("ses_A", 1, "BBBBBBBBBBBBB");
		// Re-insert index 1 with a DIFFERENT hash → keeps the original.
		idx.appendSessionTurn("ses_A", 1, "ZZZZZZZZZZZZZ");
		expect(idx.listSessionTurns("ses_A")).toEqual([
			"AAAAAAAAAAAAA",
			"BBBBBBBBBBBBB",
		]);
	});

	it("loadSessionTurnsBulk groups multiple sessions, each ordered by turn_index", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		const idx = ocas.searchIndex;
		idx.appendSessionTurn("ses_A", 0, "A0AAAAAAAAAAA");
		idx.appendSessionTurn("ses_B", 0, "B0BBBBBBBBBBB");
		idx.appendSessionTurn("ses_A", 1, "A1AAAAAAAAAAA");
		idx.appendSessionTurn("ses_B", 1, "B1BBBBBBBBBBB");
		const bulk = idx.loadSessionTurnsBulk();
		expect(bulk.get("ses_A")).toEqual(["A0AAAAAAAAAAA", "A1AAAAAAAAAAA"]);
		expect(bulk.get("ses_B")).toEqual(["B0BBBBBBBBBBB", "B1BBBBBBBBBBB"]);
	});

	it("listSessionTurns returns [] for an unknown session", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(ocas.searchIndex.listSessionTurns("ses_NOPE")).toEqual([]);
	});
});

describe("server-session-turns-table — rebuild independence", () => {
	it("FTS rebuild() does not drop sumeru_session_turns rows", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		const idx = ocas.searchIndex;
		idx.appendSessionTurn("ses_A", 0, "AAAAAAAAAAAAA");
		idx.appendSessionTurn("ses_A", 1, "BBBBBBBBBBBBB");

		idx.rebuild({
			store: ocas.store,
			turnSchemaHash: ocas.turnSchemaHash,
			sessionMetaSchemaHash: ocas.sessionMetaSchemaHash,
		});

		// The turn-list pointer survives a search re-index.
		expect(idx.listSessionTurns("ses_A")).toEqual([
			"AAAAAAAAAAAAA",
			"BBBBBBBBBBBBB",
		]);
	});
});
