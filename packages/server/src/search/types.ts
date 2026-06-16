/**
 * Phase 5 — search index types.
 *
 * These types are shared by the index module and the HTTP endpoints. The
 * `SearchIndex` is a closure carrying the SQLite handle; consumers obtain
 * one from `openSumeruOcas` via the new `searchIndex` slice on the result
 * (mirrored on `OcasConfig`).
 */

import type { Hash, Store } from "@ocas/core";
import type { SessionStatus } from "../types.js";

/**
 * Opaque handle to the FTS5 search index. Carries the SQLite database
 * handle plus the prepared statements; created by `createSearchIndex`.
 */
export type SearchIndex = {
	/**
	 * Insert a row into `sumeru_session_index`. Idempotent
	 * (`ON CONFLICT DO NOTHING`).
	 */
	indexSessionMeta: (meta: SessionMetaInput) => void;
	/**
	 * Insert a row into `sumeru_turn_index` and bump the matching session
	 * row's `turn_count` and `last_active_at`. Idempotent on the turn hash.
	 */
	indexTurn: (input: IndexTurnInput) => void;
	/** Update `sumeru_session_index.status` for a session. Best-effort. */
	markSessionClosed: (sessionId: string) => void;
	/**
	 * Phase 6 (Refs #399): persist one durable row in `sumeru_session_turns`
	 * recording `(session_id, turn_index, turn_hash)`. Idempotent on
	 * `(session_id, turn_index)` (`ON CONFLICT DO NOTHING`). This is the
	 * canonical turn-list pointer the session store rehydrates from on boot;
	 * it is NOT touched by `rebuild`.
	 */
	appendSessionTurn: (
		sessionId: string,
		turnIndex: number,
		turnHash: Hash,
	) => void;
	/**
	 * Phase 6 (Refs #399): read one session's ordered turn hashes from
	 * `sumeru_session_turns`, ordered by `turn_index ASC`. Returns `[]` for an
	 * unknown session.
	 */
	listSessionTurns: (sessionId: string) => Hash[];
	/**
	 * Phase 6 (Refs #399): bulk-load every session's ordered turn hashes in a
	 * single query, grouped by `session_id` and ordered by `turn_index ASC`.
	 * Used at store construction so rehydration is O(1) queries.
	 */
	loadSessionTurnsBulk: () => Map<string, Hash[]>;
	/**
	 * Phase 6 (Refs #399): read every persisted session row from
	 * `sumeru_session_index` (ordered by `created_at ASC`) so the store can
	 * rebuild its in-memory maps on boot.
	 */
	loadSessionRows: () => PersistedSessionRow[];
	/** Run a search and return aggregated session-granularity hits. */
	search: (opts: SearchOptions) => SearchResult;
	/** Walk the ocas store and rebuild every index row from scratch. */
	rebuild: (ocas: SearchRebuildOcas) => void;
	/** Number of rows currently in `sumeru_turn_index`. */
	turnCount: () => number;
	/** Close the underlying SQLite handle (test-only — never used by server). */
	close: () => void;
};

/**
 * Payload accepted by `indexSessionMeta`. Mirrors the public
 * `@sumeru/session-meta` schema with `status` defaulted to `idle`.
 *
 * Phase 6 (Refs #399): carries `metaHash` so the persisted
 * `sumeru_session_index` row records the immutable `@sumeru/session-meta`
 * node hash. On boot the store re-reads `config` from that node. `null` is
 * accepted for callers/tests that have no meta node (the column is nullable).
 */
export type SessionMetaInput = {
	sessionId: string;
	gateway: string;
	adapter: string;
	createdAt: string;
	metaHash: Hash | null;
};

/**
 * One row read back from `sumeru_session_index` at boot (Refs #399). Used by
 * the session store to rebuild its in-memory maps. `metaHash` is `null` for
 * rows that predate the `meta_hash` column.
 */
export type PersistedSessionRow = {
	sessionId: string;
	gateway: string;
	adapter: string;
	status: SessionStatus;
	createdAt: string;
	lastActiveAt: string;
	turnCount: number;
	metaHash: Hash | null;
};

/** Payload accepted by `indexTurn`. */
export type IndexTurnInput = {
	turnHash: Hash;
	sessionId: string;
	gateway: string;
	turnIndex: number;
	role: "user" | "assistant" | "system";
	content: string;
	createdAt: string;
};

/** Options accepted by `searchSessions` (and `search`). */
export type SearchOptions = {
	/** Raw user query — `searchSessions` trims and quotes it before binding. */
	query: string;
	/** Filter by gateway. `null` means cross-gateway. */
	gateway: string | null;
	/** 1 ≤ limit ≤ 100. */
	limit: number;
	/** ≥ 0. */
	offset: number;
	/** When true, FTS5 highlight markers (`<<` / `>>`) are stripped. */
	stripHighlights: boolean;
};

/** Single hit in `SearchResult.results`. */
export type SearchHit = {
	id: string;
	gateway: string;
	status: SessionStatus;
	relevance: number;
	matchContext: string;
	turns: number;
	lastActiveAt: string;
};

/** Internal-only result of `searchSessions`. */
export type SearchResult = {
	query: string;
	results: SearchHit[];
	/** Total distinct sessions matching `query` (before limit/offset). */
	total: number;
};

/**
 * Subset of the ocas store exposed to `rebuild`. The rebuild walker needs
 * only `cas` reads and the two schema hashes.
 */
export type SearchRebuildOcas = {
	store: Store;
	turnSchemaHash: Hash;
	sessionMetaSchemaHash: Hash;
};
