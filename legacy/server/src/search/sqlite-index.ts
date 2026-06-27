/**
 * Phase 5 — FTS5 search index.
 *
 * This module owns the SQLite FTS5 schema that backs Sumeru's session search.
 * The index lives in `<ocasDir>/_store.db` — the same file `@ocas/fs` opens
 * for variables and tags. We open a second `DatabaseSync` handle on the same
 * file (safe because `@ocas/fs` enables WAL).
 *
 * The schema:
 *   - `sumeru_turn_index`     — one row per turn (PK = turn ocas hash)
 *   - `sumeru_turn_fts`       — contentless FTS5 virtual table (mirrors content)
 *   - `sumeru_session_index`  — one row per session (PK = session id)
 *
 * Triggers keep `sumeru_turn_fts` in lockstep with `sumeru_turn_index`.
 *
 * All write paths are idempotent on the turn hash / session id, so re-indexing
 * the same node is a no-op.
 */

import { DatabaseSync } from "node:sqlite";
import type { Hash } from "@ocas/core";
import type { SessionStatus } from "../types.js";
import type {
	IndexTurnInput,
	PersistedSessionRow,
	SearchHit,
	SearchIndex,
	SearchOptions,
	SearchRebuildOcas,
	SearchResult,
	SessionMetaInput,
} from "./types.js";

const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS sumeru_turn_index (
  turn_hash      TEXT PRIMARY KEY,
  session_id     TEXT NOT NULL,
  gateway        TEXT NOT NULL,
  turn_index     INTEGER NOT NULL,
  role           TEXT NOT NULL,
  content        TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sumeru_turn_index_session
  ON sumeru_turn_index(session_id);
CREATE INDEX IF NOT EXISTS idx_sumeru_turn_index_gateway
  ON sumeru_turn_index(gateway);

CREATE TABLE IF NOT EXISTS sumeru_session_index (
  session_id      TEXT PRIMARY KEY,
  gateway         TEXT NOT NULL,
  adapter         TEXT NOT NULL,
  status          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  last_active_at  TEXT NOT NULL,
  turn_count      INTEGER NOT NULL DEFAULT 0,
  meta_hash       TEXT
);
CREATE INDEX IF NOT EXISTS idx_sumeru_session_index_gateway
  ON sumeru_session_index(gateway);
CREATE INDEX IF NOT EXISTS idx_sumeru_session_index_last_active
  ON sumeru_session_index(last_active_at DESC);

-- Phase 6 (Refs #399): durable, ordered, per-session turn-list pointer. This
-- is the canonical list the session store rehydrates on boot. It is NOT owned
-- by FTS and is never cleared by rebuild().
CREATE TABLE IF NOT EXISTS sumeru_session_turns (
  session_id  TEXT NOT NULL,
  turn_index  INTEGER NOT NULL,
  turn_hash   TEXT NOT NULL,
  PRIMARY KEY (session_id, turn_index)
);
CREATE INDEX IF NOT EXISTS idx_sumeru_session_turns_session
  ON sumeru_session_turns(session_id);

CREATE VIRTUAL TABLE IF NOT EXISTS sumeru_turn_fts USING fts5(
  content,
  content='sumeru_turn_index',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS sumeru_turn_fts_ai AFTER INSERT ON sumeru_turn_index BEGIN
  INSERT INTO sumeru_turn_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS sumeru_turn_fts_ad AFTER DELETE ON sumeru_turn_index BEGIN
  INSERT INTO sumeru_turn_fts(sumeru_turn_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;
`;

/**
 * Open a second SQLite handle on the same `_store.db` file `@ocas/fs` writes
 * vars/tags into. Creates the FTS5 schema if not present. Retries up to 3×
 * on `SQLITE_BUSY` with a 50 ms backoff.
 *
 * Throws `failed to create FTS5 index: <cause>` on persistent failure — the
 * caller (`openSumeruOcas`) prepends `failed to open ocas store at <dir>: `
 * so all boot failures share the same prefix.
 */
export function createSearchIndex(dbPath: string): SearchIndex {
	const db = openWithRetry(dbPath);
	try {
		db.exec("BEGIN");
		db.exec(SCHEMA_DDL);
		migrateMetaHashColumn(db);
		db.exec("COMMIT");
	} catch (err) {
		try {
			db.exec("ROLLBACK");
		} catch {
			// best-effort
		}
		const cause = err instanceof Error ? err.message : String(err);
		throw new Error(`failed to create FTS5 index: ${cause}`);
	}

	const insertSession = db.prepare(`
		INSERT INTO sumeru_session_index
			(session_id, gateway, adapter, status, created_at, last_active_at, turn_count, meta_hash)
		VALUES (?, ?, ?, 'idle', ?, ?, 0, ?)
		ON CONFLICT(session_id) DO NOTHING
	`);
	const insertTurn = db.prepare(`
		INSERT INTO sumeru_turn_index
			(turn_hash, session_id, gateway, turn_index, role, content, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(turn_hash) DO NOTHING
	`);
	const bumpSession = db.prepare(`
		UPDATE sumeru_session_index
		   SET last_active_at = ?,
		       turn_count     = turn_count + 1
		 WHERE session_id = ?
	`);
	const closeSession = db.prepare(`
		UPDATE sumeru_session_index
		   SET status = 'closed'
		 WHERE session_id = ?
	`);
	const countTurns = db.prepare(`SELECT COUNT(*) AS c FROM sumeru_turn_index`);
	// Phase 6 (Refs #399): turn-list pointer statements.
	const appendTurn = db.prepare(`
		INSERT INTO sumeru_session_turns (session_id, turn_index, turn_hash)
		VALUES (?, ?, ?)
		ON CONFLICT(session_id, turn_index) DO NOTHING
	`);
	const selectTurnsForSession = db.prepare(`
		SELECT turn_hash
		  FROM sumeru_session_turns
		 WHERE session_id = ?
		 ORDER BY turn_index ASC
	`);
	const selectAllTurns = db.prepare(`
		SELECT session_id, turn_hash
		  FROM sumeru_session_turns
		 ORDER BY session_id, turn_index ASC
	`);
	const selectAllSessions = db.prepare(`
		SELECT session_id, gateway, adapter, status,
		       created_at, last_active_at, turn_count, meta_hash
		  FROM sumeru_session_index
		 ORDER BY created_at ASC
	`);

	function indexSessionMeta(meta: SessionMetaInput): void {
		insertSession.run(
			meta.sessionId,
			meta.gateway,
			meta.adapter,
			meta.createdAt,
			meta.createdAt,
			meta.metaHash,
		);
	}

	function appendSessionTurn(
		sessionId: string,
		turnIndex: number,
		turnHash: Hash,
	): void {
		appendTurn.run(sessionId, turnIndex, turnHash);
	}

	function listSessionTurns(sessionId: string): Hash[] {
		const rows = selectTurnsForSession.all(sessionId) as Array<{
			turn_hash: string;
		}>;
		return rows.map((r) => r.turn_hash as Hash);
	}

	function loadSessionTurnsBulk(): Map<string, Hash[]> {
		const rows = selectAllTurns.all() as Array<{
			session_id: string;
			turn_hash: string;
		}>;
		const out = new Map<string, Hash[]>();
		for (const row of rows) {
			let list = out.get(row.session_id);
			if (list === undefined) {
				list = [];
				out.set(row.session_id, list);
			}
			list.push(row.turn_hash as Hash);
		}
		return out;
	}

	function loadSessionRows(): PersistedSessionRow[] {
		const rows = selectAllSessions.all() as Array<{
			session_id: string;
			gateway: string;
			adapter: string;
			status: string;
			created_at: string;
			last_active_at: string;
			turn_count: number;
			meta_hash: string | null;
		}>;
		return rows.map((r) => ({
			sessionId: r.session_id,
			gateway: r.gateway,
			adapter: r.adapter,
			status: normalizeStatus(r.status),
			createdAt: r.created_at,
			lastActiveAt: r.last_active_at,
			turnCount: Number(r.turn_count ?? 0),
			metaHash: r.meta_hash === null ? null : (r.meta_hash as Hash),
		}));
	}

	function indexTurn(input: IndexTurnInput): void {
		db.exec("BEGIN");
		try {
			const result = insertTurn.run(
				input.turnHash,
				input.sessionId,
				input.gateway,
				input.turnIndex,
				input.role,
				input.content,
				input.createdAt,
			);
			// On INSERT-vs-conflict: only bump turn_count when a new row was
			// actually inserted. node:sqlite's run() returns { changes } where
			// changes === 0 means the conflict path took DO NOTHING.
			if (Number(result.changes ?? 0) > 0) {
				bumpSession.run(input.createdAt, input.sessionId);
			}
			db.exec("COMMIT");
		} catch (err) {
			try {
				db.exec("ROLLBACK");
			} catch {
				// best-effort
			}
			throw err;
		}
	}

	function markSessionClosed(sessionId: string): void {
		try {
			closeSession.run(sessionId);
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			console.warn(`[sumeru] search index update failed: ${cause}`);
		}
	}

	function search(opts: SearchOptions): SearchResult {
		const trimmed = opts.query.trim();
		if (trimmed.length === 0) {
			return { query: "", results: [], total: 0 };
		}
		const matchExpr = quoteFtsPhrase(trimmed);
		const limit = clamp(opts.limit, 1, 100);
		const offset = Math.max(0, opts.offset);

		// FTS5 auxiliary functions (bm25, snippet) only work in queries that
		// reference the FTS5 virtual table at the top level; they don't work
		// through CTEs. So we collect raw matches first, then aggregate in JS.
		const matchStmt = db.prepare(`
			SELECT t.session_id AS session_id,
			       snippet(sumeru_turn_fts, 0, '<<', '>>', '…', 24) AS snip,
			       bm25(sumeru_turn_fts) AS score
			  FROM sumeru_turn_fts
			  JOIN sumeru_turn_index t ON t.rowid = sumeru_turn_fts.rowid
			 WHERE sumeru_turn_fts MATCH ?
			   AND ( ?2 IS NULL OR t.gateway = ?2 )
			 ORDER BY score ASC
		`);
		let matchRows: Array<{
			session_id: string;
			snip: string;
			score: number;
		}>;
		try {
			matchRows = matchStmt.all(matchExpr, opts.gateway) as Array<{
				session_id: string;
				snip: string;
				score: number;
			}>;
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			console.warn(`[sumeru] search index query failed: ${cause}`);
			return { query: trimmed, results: [], total: 0 };
		}
		// Aggregate to session granularity — keep best (lowest BM25) per session.
		// `matchRows` is already sorted ASC by score, so the first occurrence per
		// session is its best.
		const bestBySession = new Map<string, { score: number; snip: string }>();
		for (const row of matchRows) {
			if (!bestBySession.has(row.session_id)) {
				bestBySession.set(row.session_id, {
					score: Number(row.score),
					snip: String(row.snip),
				});
			}
		}
		const total = bestBySession.size;
		if (total === 0) {
			return { query: trimmed, results: [], total: 0 };
		}

		// Read session rows in one IN-clause query, then re-order in JS by best
		// score ASC, last_active_at DESC for stable tie-break.
		const ids = Array.from(bestBySession.keys());
		const placeholders = ids.map(() => "?").join(", ");
		const sessionStmt = db.prepare(`
			SELECT session_id, gateway, status, last_active_at, turn_count
			  FROM sumeru_session_index
			 WHERE session_id IN (${placeholders})
		`);
		const sessionRows = sessionStmt.all(...ids) as Array<{
			session_id: string;
			gateway: string;
			status: string;
			last_active_at: string;
			turn_count: number;
		}>;

		type Row = {
			best: { score: number; snip: string };
			session: (typeof sessionRows)[number];
		};
		const merged: Row[] = [];
		for (const sess of sessionRows) {
			const best = bestBySession.get(sess.session_id);
			if (best === undefined) continue;
			merged.push({ best, session: sess });
		}
		merged.sort((a, b) => {
			if (a.best.score !== b.best.score) return a.best.score - b.best.score;
			// Tie-break by last_active_at DESC (newer first).
			return a.session.last_active_at > b.session.last_active_at
				? -1
				: a.session.last_active_at < b.session.last_active_at
					? 1
					: 0;
		});

		const paged = merged.slice(offset, offset + limit);
		const results: SearchHit[] = [];
		for (const r of paged) {
			const score = r.best.score;
			// FTS5 BM25 is negative-weighted by default in SQLite (lower = better,
			// negative numbers are common). Use abs for normalization so the
			// 1/(1+|s|) formula keeps the (0, 1] mapping regardless of sign.
			const relevance = 1 / (1 + Math.abs(score));
			const rawSnip = r.best.snip;
			const matchContext = opts.stripHighlights
				? rawSnip.replace(/<<|>>/g, "")
				: rawSnip;
			results.push({
				id: r.session.session_id,
				gateway: r.session.gateway,
				status: r.session.status as SessionStatus,
				relevance,
				matchContext,
				turns: Number(r.session.turn_count ?? 0),
				lastActiveAt: r.session.last_active_at,
			});
		}
		return { query: trimmed, results, total };
	}

	function rebuild(ocas: SearchRebuildOcas): void {
		// Step 1: Read sumeru_session_turns BEFORE any deletes to build
		// turnHash → sessionId lookup (this table survives the rebuild).
		const turnAssocRows = selectAllTurns.all() as Array<{
			session_id: string;
			turn_hash: string;
		}>;
		const turnHashToSessionId = new Map<string, string>();
		for (const row of turnAssocRows) {
			turnHashToSessionId.set(row.turn_hash, row.session_id);
		}

		// Step 2: DELETE from FTS index tables (sumeru_session_turns is NOT touched).
		db.exec("BEGIN");
		try {
			db.exec("DELETE FROM sumeru_turn_index");
			db.exec("DELETE FROM sumeru_session_index");
			db.exec("COMMIT");
		} catch (err) {
			try {
				db.exec("ROLLBACK");
			} catch {
				// best-effort
			}
			throw err;
		}

		// Step 3: Enumerate all session-meta nodes from ocas store.
		const sessionMetaEntries = ocas.store.cas.listByType(
			ocas.sessionMetaSchemaHash,
		);

		// Step 4-6: Index each session-meta and build sessionId → gateway map.
		const sessionIdToGateway = new Map<string, string>();
		for (const entry of sessionMetaEntries) {
			const node = ocas.store.cas.get(entry.hash);
			if (node === null) continue;
			const payload = node.payload as {
				id: string;
				gateway: string;
				adapter: string;
				createdAt: string;
			};
			indexSessionMeta({
				sessionId: payload.id,
				gateway: payload.gateway,
				adapter: payload.adapter,
				createdAt: payload.createdAt,
				metaHash: entry.hash as Hash,
			});
			sessionIdToGateway.set(payload.id, payload.gateway);
		}

		// Step 7-8: Enumerate all turn nodes and index them.
		const turnEntries = ocas.store.cas.listByType(ocas.turnSchemaHash);
		for (const entry of turnEntries) {
			const node = ocas.store.cas.get(entry.hash);
			if (node === null) continue;
			const payload = node.payload as {
				index: number;
				role: "user" | "assistant" | "system";
				content: string;
				timestamp: string;
			};

			// Look up sessionId from the turnHash → sessionId map.
			const sessionId = turnHashToSessionId.get(entry.hash);
			if (sessionId === undefined) {
				console.warn(`[sumeru] rebuild: skipping orphaned turn ${entry.hash}`);
				continue;
			}

			// Look up gateway from the sessionId → gateway map.
			const gateway = sessionIdToGateway.get(sessionId);
			if (gateway === undefined) {
				console.warn(`[sumeru] rebuild: skipping orphaned turn ${entry.hash}`);
				continue;
			}

			indexTurn({
				turnHash: entry.hash as Hash,
				sessionId,
				gateway,
				turnIndex: payload.index,
				role: payload.role,
				content: payload.content,
				createdAt: payload.timestamp,
			});
		}

		// Step 9: Corrective UPDATE to fix turn_count and last_active_at.
		db.exec(`
			UPDATE sumeru_session_index
			   SET turn_count = (
			         SELECT COUNT(*) FROM sumeru_turn_index
			          WHERE sumeru_turn_index.session_id = sumeru_session_index.session_id
			       ),
			       last_active_at = COALESCE(
			         (SELECT MAX(created_at) FROM sumeru_turn_index
			           WHERE sumeru_turn_index.session_id = sumeru_session_index.session_id),
			         sumeru_session_index.created_at
			       )
		`);
	}

	function turnCount(): number {
		const row = countTurns.get() as { c?: number } | undefined;
		return Number(row?.c ?? 0);
	}

	function close(): void {
		db.close();
	}

	return {
		indexSessionMeta,
		indexTurn,
		markSessionClosed,
		appendSessionTurn,
		listSessionTurns,
		loadSessionTurnsBulk,
		loadSessionRows,
		search,
		rebuild,
		turnCount,
		close,
	};
}

/**
 * Walk every `@sumeru/session-meta` and `@sumeru/turn` node in the ocas store
 * and rebuild the FTS5 index from scratch. The internal `rebuild` closure
 * handles full enumeration via `listByType` and uses `sumeru_session_turns`
 * for turn→session association.
 *
 * Callers no longer need to supply `roots` — the store is the source of truth.
 */
export function rebuildSearchIndex(
	index: SearchIndex,
	ocas: SearchRebuildOcas,
): void {
	index.rebuild(ocas);
}

/** Wrap a query in `"..."` and double internal `"` to force FTS5 phrase mode. */
export function quoteFtsPhrase(raw: string): string {
	return `"${raw.replace(/"/g, '""')}"`;
}

/**
 * Public wrapper that exposes the same `searchSessions` signature the spec
 * documents. Equivalent to calling `index.search(opts)` with `stripHighlights`
 * defaulted to `false`.
 */
export function searchSessions(
	index: SearchIndex,
	opts: Omit<SearchOptions, "stripHighlights"> & {
		stripHighlights?: boolean;
	},
): SearchResult {
	return index.search({
		query: opts.query,
		gateway: opts.gateway,
		limit: opts.limit,
		offset: opts.offset,
		stripHighlights: opts.stripHighlights ?? false,
	});
}

function clamp(n: number, min: number, max: number): number {
	if (Number.isNaN(n)) return min;
	if (n < min) return min;
	if (n > max) return max;
	return n;
}

/**
 * Phase 6 (Refs #399): add the nullable `meta_hash` column to a pre-existing
 * `sumeru_session_index` that predates it. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so we probe `PRAGMA table_info` first and only
 * `ALTER` when the column is absent. Runs inside the open transaction; a no-op
 * when the column already exists (fresh DBs already define it in the DDL).
 */
function migrateMetaHashColumn(db: DatabaseSync): void {
	const cols = db
		.prepare("PRAGMA table_info(sumeru_session_index)")
		.all() as Array<{ name: string }>;
	const hasMetaHash = cols.some((c) => c.name === "meta_hash");
	if (!hasMetaHash) {
		db.exec("ALTER TABLE sumeru_session_index ADD COLUMN meta_hash TEXT");
	}
}

/**
 * Normalize a persisted status column into a `SessionStatus` for rehydration.
 * `closed` is preserved; everything else (idle, active, or any unexpected
 * value) folds to `idle` — a process restart can never leave a send in flight,
 * so `active` is a transient in-memory state that must not be restored.
 */
function normalizeStatus(raw: string): SessionStatus {
	return raw === "closed" ? "closed" : "idle";
}

/** Open a SQLite handle, retrying on SQLITE_BUSY up to 3× with 50 ms backoff. */
function openWithRetry(dbPath: string): DatabaseSync {
	let lastErr: unknown = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const db = new DatabaseSync(dbPath);
			db.exec("PRAGMA journal_mode = WAL");
			db.exec("PRAGMA foreign_keys = ON");
			return db;
		} catch (err) {
			lastErr = err;
			const msg = err instanceof Error ? err.message : String(err);
			if (!/busy/i.test(msg) && !/locked/i.test(msg)) throw err;
			// 50 ms busy-wait
			const start = Date.now();
			while (Date.now() - start < 50) {
				/* spin */
			}
		}
	}
	const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
	throw new Error(`failed to create FTS5 index: ${cause}`);
}
