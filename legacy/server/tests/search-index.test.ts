/**
 * Phase 5 — `server-fts5-index.md`.
 *
 * Tests the FTS5 search index module — schema bootstrap, indexing, search,
 * and rebuild. These tests exercise the in-memory `SearchIndex` directly
 * without going through HTTP.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
	createSearchIndex,
	openSumeruOcas,
	quoteFtsPhrase,
	type SearchIndex,
	searchSessions,
} from "../src/index.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

function tableNames(dbPath: string): Set<string> {
	const db = new DatabaseSync(dbPath);
	const rows = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'sumeru_%'",
		)
		.all() as Array<{ name: string }>;
	const result = new Set(rows.map((r) => r.name));
	db.close();
	return result;
}

function seedSession(
	index: SearchIndex,
	id: string,
	gateway: string,
	createdAt: string,
): void {
	index.indexSessionMeta({
		sessionId: id,
		gateway,
		adapter: "stub",
		createdAt,
		metaHash: null,
	});
}

function seedTurn(
	index: SearchIndex,
	turnHash: string,
	sessionId: string,
	gateway: string,
	turnIndex: number,
	content: string,
	role: "user" | "assistant" = "assistant",
	createdAt = "2026-01-01T00:00:00Z",
): void {
	index.indexTurn({
		turnHash,
		sessionId,
		gateway,
		turnIndex,
		role,
		content,
		createdAt,
	});
}

describe("Phase 5 — FTS5 search index", () => {
	it("openSumeruOcas creates the FTS5 schema on a fresh dir", () => {
		const dir = tmpOcasDir();
		openSumeruOcas(dir);
		const names = tableNames(join(dir, "_store.db"));
		expect(names.has("sumeru_turn_index")).toBe(true);
		expect(names.has("sumeru_session_index")).toBe(true);
		expect(names.has("sumeru_turn_fts")).toBe(true);
		expect(names.has("sumeru_turn_fts_ai")).toBe(true);
		expect(names.has("sumeru_turn_fts_ad")).toBe(true);
	});

	it("re-opening an existing dir is idempotent", () => {
		const dir = tmpOcasDir();
		openSumeruOcas(dir);
		expect(() => openSumeruOcas(dir)).not.toThrow();
	});

	it("indexSessionMeta is idempotent on session_id (ON CONFLICT DO NOTHING)", () => {
		const dir = tmpOcasDir();
		const ocas = openSumeruOcas(dir);
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2099-01-01T00:00:00Z");
		const result = ocas.searchIndex.search({
			query: "anything",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		expect(result.results).toEqual([]);
	});

	it("indexTurn bumps session turn_count and last_active_at", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(
			ocas.searchIndex,
			"AAAAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"login redirect bug",
			"user",
			"2026-01-02T00:00:00Z",
		);
		seedTurn(
			ocas.searchIndex,
			"BBBBBBBBBBBBB",
			"ses_A",
			"hermes",
			1,
			"check the logs",
			"assistant",
			"2026-01-02T00:00:01Z",
		);
		const r = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: true,
		});
		expect(r.results.length).toBe(1);
		const hit = r.results[0];
		if (hit === undefined) throw new Error("expected hit");
		expect(hit.id).toBe("ses_A");
		expect(hit.turns).toBe(2);
		expect(hit.lastActiveAt).toBe("2026-01-02T00:00:01Z");
		expect(hit.matchContext).toContain("login");
		expect(hit.relevance).toBeGreaterThan(0);
		expect(hit.relevance).toBeLessThanOrEqual(1);
	});

	it("indexTurn is idempotent on turn_hash (no over-counting)", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(
			ocas.searchIndex,
			"AAAAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"login redirect bug",
		);
		seedTurn(
			ocas.searchIndex,
			"AAAAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"login redirect bug",
		);
		const r = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		const hit = r.results[0];
		if (hit === undefined) throw new Error("expected hit");
		expect(hit.turns).toBe(1);
	});

	it("cross-gateway search returns sessions from all gateways", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedSession(ocas.searchIndex, "ses_B", "hermes", "2026-01-01T00:00:00Z");
		seedSession(
			ocas.searchIndex,
			"ses_D",
			"claude-code",
			"2026-01-01T00:00:00Z",
		);
		seedTurn(
			ocas.searchIndex,
			"A1AAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"login redirect bug",
		);
		seedTurn(
			ocas.searchIndex,
			"B1BBBBBBBBBBB",
			"ses_B",
			"hermes",
			0,
			"deploy timeout",
		);
		seedTurn(
			ocas.searchIndex,
			"D1DDDDDDDDDDD",
			"ses_D",
			"claude-code",
			0,
			"refactor login form to use new auth",
		);
		const r = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: true,
		});
		expect(r.total).toBe(2);
		const ids = r.results.map((h) => h.id);
		expect(ids).toContain("ses_A");
		expect(ids).toContain("ses_D");
		expect(ids).not.toContain("ses_B");
	});

	it("per-gateway search filters out other gateways", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedSession(
			ocas.searchIndex,
			"ses_D",
			"claude-code",
			"2026-01-01T00:00:00Z",
		);
		seedTurn(
			ocas.searchIndex,
			"A1AAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"login redirect bug",
		);
		seedTurn(
			ocas.searchIndex,
			"D1DDDDDDDDDDD",
			"ses_D",
			"claude-code",
			0,
			"refactor login form",
		);
		const hermes = ocas.searchIndex.search({
			query: "login",
			gateway: "hermes",
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		expect(hermes.total).toBe(1);
		expect(hermes.results.map((h) => h.id)).toEqual(["ses_A"]);
		const claude = ocas.searchIndex.search({
			query: "login",
			gateway: "claude-code",
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		expect(claude.total).toBe(1);
		expect(claude.results.map((h) => h.id)).toEqual(["ses_D"]);
	});

	it("relevance is in (0, 1] for every hit", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(ocas.searchIndex, "A1AAAAAAAAAAA", "ses_A", "hermes", 0, "login");
		const r = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		const hit = r.results[0];
		if (hit === undefined) throw new Error("expected hit");
		expect(hit.relevance).toBeGreaterThan(0);
		expect(hit.relevance).toBeLessThanOrEqual(1);
	});

	it("matchContext keeps highlight markers by default, strips on opt-in", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(
			ocas.searchIndex,
			"A1AAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"please look at login redirect",
		);
		const withMarkers = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		const wmHit = withMarkers.results[0];
		if (wmHit === undefined) throw new Error("expected hit");
		expect(wmHit.matchContext).toMatch(/<<.*>>/);
		const stripped = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: true,
		});
		const sHit = stripped.results[0];
		if (sHit === undefined) throw new Error("expected hit");
		expect(sHit.matchContext).not.toContain("<<");
		expect(sHit.matchContext).not.toContain(">>");
	});

	it("empty / whitespace query returns empty result with no SQL", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		const r1 = ocas.searchIndex.search({
			query: "",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		expect(r1).toEqual({ query: "", results: [], total: 0 });
		const r2 = ocas.searchIndex.search({
			query: "   ",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		expect(r2).toEqual({ query: "", results: [], total: 0 });
	});

	it("FTS-syntax-special chars do not throw — quoted as a phrase", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(
			ocas.searchIndex,
			"A1AAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"hello world",
		);
		expect(() =>
			ocas.searchIndex.search({
				query: 'login (admin OR root) "x"',
				gateway: null,
				limit: 10,
				offset: 0,
				stripHighlights: false,
			}),
		).not.toThrow();
	});

	it("pagination — disjoint coverage", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		for (let i = 0; i < 6; i += 1) {
			const id = `ses_${String(i).padStart(2, "0")}`;
			seedSession(ocas.searchIndex, id, "hermes", `2026-01-01T00:00:0${i}Z`);
			seedTurn(
				ocas.searchIndex,
				`H${String(i).padStart(12, "0")}`,
				id,
				"hermes",
				0,
				`login example ${i}`,
				"user",
				`2026-01-01T00:00:0${i}Z`,
			);
		}
		const page1 = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 2,
			offset: 0,
			stripHighlights: false,
		});
		const page2 = ocas.searchIndex.search({
			query: "login",
			gateway: null,
			limit: 2,
			offset: 2,
			stripHighlights: false,
		});
		expect(page1.total).toBe(6);
		expect(page2.total).toBe(6);
		expect(page1.results.length).toBe(2);
		expect(page2.results.length).toBe(2);
		const overlap = page1.results.filter((p1) =>
			page2.results.some((p2) => p2.id === p1.id),
		);
		expect(overlap).toEqual([]);
	});

	it("durability across openSumeruOcas calls (shared on-disk DB)", () => {
		const dir = tmpOcasDir();
		const a = openSumeruOcas(dir);
		seedSession(a.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(
			a.searchIndex,
			"A1AAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"please look at login redirect",
		);
		// Close the DB handle so the second open sees a settled state.
		a.searchIndex.close();
		const b = openSumeruOcas(dir);
		const r = b.searchIndex.search({
			query: "redirect",
			gateway: null,
			limit: 10,
			offset: 0,
			stripHighlights: false,
		});
		expect(r.total).toBe(1);
		expect(r.results[0]?.id).toBe("ses_A");
	});

	it("createSearchIndex initial turn count is 0 on fresh dir", () => {
		const dir = tmpOcasDir();
		const idx = createSearchIndex(join(dir, "_store.db"));
		expect(idx.turnCount()).toBe(0);
	});

	it("quoteFtsPhrase doubles internal quotes", () => {
		expect(quoteFtsPhrase('login "x"')).toBe('"login ""x"""');
	});

	it("searchSessions wrapper defaults stripHighlights to false", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		seedSession(ocas.searchIndex, "ses_A", "hermes", "2026-01-01T00:00:00Z");
		seedTurn(
			ocas.searchIndex,
			"A1AAAAAAAAAAA",
			"ses_A",
			"hermes",
			0,
			"please look at login redirect",
		);
		const r = searchSessions(ocas.searchIndex, {
			query: "login",
			gateway: null,
			limit: 10,
			offset: 0,
		});
		expect(r.results[0]?.matchContext).toMatch(/<<.*>>/);
	});
});
