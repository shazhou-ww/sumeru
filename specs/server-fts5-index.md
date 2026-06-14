---
scenario: "Sumeru maintains a SQLite FTS5 index of session turn content alongside the ocas store; turn writes append to it synchronously, session-meta writes seed it, and the index is the data source for the search endpoints"
feature: server-search
tags: [search, fts5, sqlite, ocas, recording, phase-5]
---

## Given
- Phase-4 is complete: `@sumeru/server` boots an `@ocas/fs` store at `<ocasDir>` (see `server-ocas-store-bootstrap.md`), registers `@sumeru/turn` and `@sumeru/session-meta`, and writes turn nodes via `recordPayload` (see `server-ocas-turn-recording.md`, `server-ocas-session-meta.md`).
- `@ocas/fs` already opens a SQLite database at `<ocasDir>/_store.db` for variables and tags (`createSqliteVarStore` in `packages/fs/src/sqlite-store.ts`). FTS5 is a built-in extension of `node:sqlite` and does NOT require a separate dependency. Phase 5 reuses the **same** database file — it does not open a second SQLite handle, so transactional writes against `vars`, `tags`, and the new FTS5 tables stay coherent.
- A new module `packages/server/src/search/index.ts` (with `types.ts` for shared types, per the project's "every folder exports via index.ts" rule) owns:
  - the FTS5 schema (DDL),
  - the `SearchIndex` type (a closure over the SQLite handle),
  - the `indexTurn` / `indexSessionMeta` write functions,
  - the `searchSessions` read function,
  - and a `rebuildSearchIndex` helper used by tests and by future migrations.
- The `OcasConfig` type on `ServerConfig` (in `packages/server/src/types.ts`) gains a sibling slice: `searchIndex: SearchIndex`. Both `ocas` and `searchIndex` are constructed inside `openSumeruOcas` so they share the same SQLite handle. `openSumeruOcas` exports `SumeruOcas` containing `searchIndex` so callers don't construct it directly.
- The architecture spec (`specs/architecture.md`) declares: search uses **FTS5**, returns a `@sumeru/search-result` envelope with `relevance` and `matchContext` fields per hit, and is the data source for `GET /sessions?q=...` and `GET /gateways/:name/sessions?q=...`.

## When
- The server boots with a fresh `--ocas-dir`. No prior FTS5 tables exist.
- Various `POST /gateways/:name/sessions` and `POST /gateways/:name/sessions/:id/messages` calls happen.
- The server is restarted (process exits, restarts pointing at the same dir).
- A consumer calls the internal `searchSessions(searchIndex, { query, gateway })` function.

## Then
- **FTS5 schema (DDL)** — On the first `openSumeruOcas` call against a directory, a SQLite transaction creates the following tables IF NOT EXISTS:
  ```sql
  -- A row per turn. Used both as the FTS5 source and as the per-session
  -- aggregator. Primary key is the turn's ocas hash so re-indexing is idempotent.
  CREATE TABLE IF NOT EXISTS sumeru_turn_index (
    turn_hash      TEXT PRIMARY KEY,         -- 13-char Crockford Base32 ocas hash
    session_id     TEXT NOT NULL,            -- ses_<ULID>
    gateway        TEXT NOT NULL,            -- gateway name (denormalized for filter)
    turn_index     INTEGER NOT NULL,         -- Turn.index from @sumeru/core
    role           TEXT NOT NULL,            -- "user" | "assistant"
    content        TEXT NOT NULL,            -- Turn.content (verbatim)
    created_at     TEXT NOT NULL             -- Turn.timestamp (ISO-8601)
  );
  CREATE INDEX IF NOT EXISTS idx_sumeru_turn_index_session
    ON sumeru_turn_index(session_id);
  CREATE INDEX IF NOT EXISTS idx_sumeru_turn_index_gateway
    ON sumeru_turn_index(gateway);

  -- A row per session. Updated on session create AND on every turn write
  -- (last_active_at = max(turn.timestamp)). Used to power the search-result
  -- listing.
  CREATE TABLE IF NOT EXISTS sumeru_session_index (
    session_id      TEXT PRIMARY KEY,
    gateway         TEXT NOT NULL,
    adapter         TEXT NOT NULL,
    status          TEXT NOT NULL,           -- mirrors in-memory status; updated on close
    created_at      TEXT NOT NULL,
    last_active_at  TEXT NOT NULL,           -- starts == created_at; bumped on every turn write
    turn_count      INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_sumeru_session_index_gateway
    ON sumeru_session_index(gateway);
  CREATE INDEX IF NOT EXISTS idx_sumeru_session_index_last_active
    ON sumeru_session_index(last_active_at DESC);

  -- Contentless FTS5 — content lives in sumeru_turn_index; we just want the
  -- BM25-ranked tokenized index. tokenize=unicode61 + remove_diacritics=2 is
  -- the SQLite default for international text and handles CJK-by-character
  -- adequately for the MVP. (The architecture spec's example query is
  -- "login重定向" — a mixed Latin/CJK string; unicode61 tokenizes it as
  -- ["login", "重", "定", "向"] which is good enough for FTS5 MATCH.)
  CREATE VIRTUAL TABLE IF NOT EXISTS sumeru_turn_fts USING fts5(
    content,
    content='sumeru_turn_index',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
  );

  -- Triggers keep the FTS5 table in lockstep with sumeru_turn_index.
  CREATE TRIGGER IF NOT EXISTS sumeru_turn_fts_ai AFTER INSERT ON sumeru_turn_index BEGIN
    INSERT INTO sumeru_turn_fts(rowid, content) VALUES (new.rowid, new.content);
  END;
  CREATE TRIGGER IF NOT EXISTS sumeru_turn_fts_ad AFTER DELETE ON sumeru_turn_index BEGIN
    INSERT INTO sumeru_turn_fts(sumeru_turn_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  END;
  ```
  - The schema is wrapped in a single `BEGIN; ...; COMMIT;` so partial creation cannot leave a half-built index. On `EBUSY`/`SQLITE_BUSY`, the call retries up to 3 times with 50 ms backoff; persistent failure rejects the boot with `failed to open ocas store at <dir>: failed to create FTS5 index: <cause>` (the same error prefix used by `openSumeruOcas` for store-open failures, so tests can match a single regex).
  - All four CREATE statements are `IF NOT EXISTS`, so opening an existing store is a no-op.
- **`indexSessionMeta(searchIndex, meta)`** — Called by `createSessionStore.create` AFTER `recordPayload(SUMERU_SESSION_META_SCHEMA_HASH, ...)` succeeds. Inserts a row into `sumeru_session_index`:
  ```sql
  INSERT INTO sumeru_session_index
    (session_id, gateway, adapter, status, created_at, last_active_at, turn_count)
  VALUES (?, ?, ?, 'idle', ?, ?, 0)
  ON CONFLICT(session_id) DO NOTHING;
  ```
  `ON CONFLICT DO NOTHING` makes re-bootstraps (e.g. `rebuildSearchIndex`) safe.
- **`indexTurn(searchIndex, { sessionId, gateway, turn, hash })`** — Called by the message endpoint (`packages/server/src/sse/messages.ts`) immediately after `recordPayload(SUMERU_TURN_SCHEMA_HASH, turn)` succeeds and BEFORE the SSE `event: turn` is written. Inside a single transaction:
  ```sql
  INSERT INTO sumeru_turn_index
    (turn_hash, session_id, gateway, turn_index, role, content, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(turn_hash) DO NOTHING;

  UPDATE sumeru_session_index
     SET last_active_at = ?,
         turn_count     = turn_count + 1
   WHERE session_id = ?;
  ```
  - `ON CONFLICT DO NOTHING` covers the rare ocas hash collision (the same byte-identical turn already indexed) — turning it into a no-op keeps `turn_count` from over-counting.
  - The trigger on `sumeru_turn_index` propagates the row to `sumeru_turn_fts` automatically.
  - If the SQLite write throws (disk full, locked database after retries), the message endpoint returns `500 search_index_failed` with `value.message: "Failed to update search index: <cause-truncated-to-500>"` and aborts the SSE stream cleanly. **The ocas write has already happened**, so the index can be rebuilt (`rebuildSearchIndex`) without data loss; this is the trade-off described below.
  - The user turn (which is recorded BEFORE `adapter.send`) goes through the same `indexTurn` path. If the search-index write for the user turn fails, the server returns `500 search_index_failed` and `tryActivate` is rolled back to `idle` — same shape as the existing `ocas_write_failed` path in `server-ocas-turn-recording.md`.
- **Close path** — `sessions.close(gateway, id)` ALSO updates `sumeru_session_index.status = 'closed'`. The update is best-effort: the underlying `DELETE` HTTP response is 204 even if the index update fails (the in-memory status flip is the source of truth on the wire). Failed index updates are logged once at warn level (`[sumeru] search index update failed: <cause>`); the next process restart will reconcile via `rebuildSearchIndex` if invoked.
- **`searchSessions(searchIndex, opts)` function signature** —
  ```typescript
  export type SearchOptions = {
    query: string;                  // raw user query (MUST be non-empty)
    gateway: string | null;         // null = cross-gateway
    limit: number;                  // 1 ≤ limit ≤ 100
    offset: number;                 // ≥ 0
  };

  export type SearchHit = {
    id: string;                     // ses_<ULID>
    gateway: string;
    status: SessionStatus;
    relevance: number;              // BM25-derived; higher = better; in (0, 1]
    matchContext: string;           // best matching snippet (≤ 240 chars)
    turns: number;                  // session_index.turn_count
    lastActiveAt: string;           // ISO-8601
  };

  export type SearchResult = {
    query: string;
    results: SearchHit[];
  };

  export function searchSessions(
    index: SearchIndex,
    opts: SearchOptions,
  ): SearchResult;
  ```
  - Internal SQL (parameterised — never string-concatenated):
    ```sql
    -- For each session that has at least one matching turn, take the best
    -- (lowest BM25) match; aggregate to session granularity.
    WITH matched AS (
      SELECT t.session_id,
             t.rowid                                       AS turn_rowid,
             snippet(sumeru_turn_fts, 0, '<<', '>>', '…', 24) AS snip,
             bm25(sumeru_turn_fts)                         AS score
        FROM sumeru_turn_fts
        JOIN sumeru_turn_index t ON t.rowid = sumeru_turn_fts.rowid
       WHERE sumeru_turn_fts MATCH ?                       -- :query
         AND ( ?2 IS NULL OR t.gateway = ?2 )              -- :gateway
    ),
    best AS (
      SELECT session_id,
             MIN(score) AS best_score,
             -- pick the snip from the row with min score per session
             (SELECT snip FROM matched m2
               WHERE m2.session_id = m1.session_id
               ORDER BY score ASC LIMIT 1) AS best_snip
        FROM matched m1
       GROUP BY session_id
    )
    SELECT s.session_id,
           s.gateway,
           s.status,
           s.last_active_at,
           s.turn_count,
           b.best_score,
           b.best_snip
      FROM best b
      JOIN sumeru_session_index s ON s.session_id = b.session_id
     ORDER BY b.best_score ASC,    -- BM25: lower is more relevant
              s.last_active_at DESC -- stable tiebreak
     LIMIT ? OFFSET ?;
    ```
  - **Relevance normalisation** — BM25 scores from FTS5 are unbounded positive reals; lower is better. The function maps each row's score to a `relevance` in `(0, 1]` via `relevance = 1 / (1 + best_score)`. A perfect-match score of `0` becomes `1.0`; large scores asymptote to `0`. Tests assert `0 < relevance ≤ 1` and that ordering by `relevance DESC` matches the SQL `ORDER BY best_score ASC`.
  - **Snippet** — `matchContext` is the FTS5 `snippet(...)` output: at most 24 tokens, `<<` / `>>` highlight markers, `…` ellipsis. The implementation strips the highlight markers in the returned string only when the test fixture uses a snippet helper (`strip` mode); the production endpoint returns the marked snippet so the client can highlight matches in the UI. (Tests cover both default and `strip` modes via a function option `stripHighlights: boolean`.)
- **Query-string sanitisation** — `searchSessions` MUST quote the user's query to prevent FTS5 syntax errors when the query contains characters FTS5 treats as operators (`-`, `"`, `:`, `(`, `)`, `*`, `OR`, `AND`, `NOT`, `NEAR`). The implementation:
  1. Trims whitespace.
  2. If trimmed length is 0, returns `{ query: "", results: [] }` immediately (do NOT hit SQLite).
  3. Wraps the trimmed query in `"..."` and escapes any internal `"` by doubling it (`""`). This forces FTS5 phrase mode — the simplest predictable behavior for arbitrary user input. Wildcards / boolean operators are NOT exposed in this MVP.
  - Test: `query = 'login (admin OR root) "x"'` is escaped as `"login (admin OR root) ""x"""` and the SQL `MATCH ?` parameter binds that string. Result is empty when no turn matches that literal phrase, and does NOT throw a `fts5: syntax error`.
- **`rebuildSearchIndex(searchIndex, ocas)`** — An admin/test helper that walks every `@sumeru/session-meta` and `@sumeru/turn` node in the ocas store and re-issues the `indexSessionMeta` / `indexTurn` writes (after a `DELETE FROM sumeru_turn_index; DELETE FROM sumeru_session_index;` inside a transaction). Wired up in tests; no CLI flag in this issue. It is the reconciliation path for index corruption / future schema migrations.
- **Server boot wiring** —
  - `openSumeruOcas` returns the existing `SumeruOcas` shape augmented with `searchIndex: SearchIndex`. The shared `DatabaseSync` instance is created once and passed both to `createSqliteVarStore` (existing) and to `createSearchIndex` (new). Tests assert exactly one DB handle is opened per server (a counter on a wrapper around `node:sqlite`'s `DatabaseSync`).
  - The startup banner gains a one-line log: `[sumeru] search index ready: <count> turns indexed` after the FTS5 tables are validated. On a fresh dir the count is 0; on a reused dir it equals `SELECT COUNT(*) FROM sumeru_turn_index`.
- **Cross-restart durability** —
  - Boot 1: create session A on `hermes`, send `"please look at login redirect"`, server stops cleanly.
  - Boot 2: open the same `--ocas-dir`. Without re-creating any sessions, calling `searchSessions(searchIndex, { query: "redirect", gateway: null, limit: 10, offset: 0 })` returns 1 hit pointing at session A. The `sumeru_session_index` row survived; the FTS5 table survived; `relevance` is in `(0, 1]`.
  - Tests use two consecutive `startServer({ ocasDir })`/`stop()` cycles in the same temp dir.
- **Trade-offs / non-goals (Phase 5)** —
  - **No embeddings.** Pure FTS5; the architecture spec promises embeddings as a follow-up.
  - **No incremental ranking weights** (e.g. boosting recent turns). BM25 default ordering only.
  - **No streaming search** (the result set is small enough to fit in memory; pagination handles large queries).
  - **No on-write content sanitisation** — `Turn.content` is indexed verbatim (it's already a UTF-8 string per the schema). PII redaction, if needed, lands later.
- **Tests** under `packages/server/tests/search-index.test.ts`:
  - **Schema bootstrap** — `openSumeruOcas` on a fresh dir creates all four tables/triggers; the table list (`SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger') AND name LIKE 'sumeru_%' OR name LIKE 'idx_sumeru_%'`) matches the expected set exactly.
  - **`indexSessionMeta`** — After 3 `POST /gateways/hermes/sessions` calls, `SELECT COUNT(*) FROM sumeru_session_index WHERE gateway='hermes'` is 3 and each row's `created_at == last_active_at`, `turn_count == 0`, `status == 'idle'`.
  - **`indexTurn` updates session row** — After 1 send producing 1 user + 2 assistant turns, the session's `turn_count` is 3 and `last_active_at` equals the latest turn's timestamp. `sumeru_turn_index` has 3 matching rows.
  - **FTS trigger fires** — `INSERT INTO sumeru_turn_index (..., content='login redirect bug')` results in `SELECT rowid FROM sumeru_turn_fts WHERE sumeru_turn_fts MATCH 'login'` returning the same rowid.
  - **`searchSessions` cross-gateway** — Three sessions across `hermes` and `claude-code`, content `"login redirect bug"`, `"deploy timeout"`, `"refactor login"`. Query `"login"` returns 2 hits; both sessions appear once (de-duplicated by `session_id`). Ordering: the session whose turn matched `login` more times comes first (lower BM25).
  - **`searchSessions` per-gateway** — Same fixture, `gateway: "hermes"` returns only the `hermes` session(s); `gateway: "claude-code"` returns only the `claude-code` session(s).
  - **Relevance bounds** — Every hit's `relevance` ∈ `(0, 1]`, and a perfect single-token match (one short turn whose entire content is the query) yields the highest relevance (`> 0.5`). A long, weakly-matching turn yields a lower relevance (`< 0.5`).
  - **Match context** — The `matchContext` string contains `<<` `>>` markers around the matched token. Tests use `stripHighlights: true` to assert the underlying snippet shape without coupling to FTS5's exact whitespace.
  - **Empty query** — `query: "   "` returns `{ query: "", results: [] }` with zero SQLite calls (instrumented via a wrapper).
  - **FTS-syntax-special chars** — `query: 'login (admin OR root) "x"'` does NOT throw; result is well-formed (possibly empty).
  - **Pagination** — 6 matching sessions, `limit=2 offset=0` then `limit=2 offset=2` produce disjoint, ordered slices that cover the first 4 results.
  - **Re-index idempotency** — Calling `indexTurn` twice with the same hash leaves `turn_count` at +1, not +2 (the `ON CONFLICT DO NOTHING` path).
  - **`rebuildSearchIndex`** — After `DELETE FROM sumeru_turn_index; DELETE FROM sumeru_session_index;` and calling `rebuildSearchIndex(searchIndex, ocas)`, the COUNT(*) restores to the pre-delete value and `searchSessions` returns the same hits as before.
  - **Restart durability** — Two consecutive `startServer`/`stop` cycles against the same dir; search hits from boot 1 are visible after boot 2 without re-indexing.
  - **Single DB handle** — A test wrapper counts `new DatabaseSync(...)` calls; per server start, exactly 1.
  - **Index update failure on send** — Stub the SQLite handle to throw on the next `INSERT INTO sumeru_turn_index`. The send returns `500 search_index_failed`, the ocas turn IS still present (durable), `Session.turnHashes` is rolled back to its pre-send length (server reverts the in-memory append in the same path that flips status back to idle).
- All Phase-1/2/3/4 tests continue to pass. Existing tests that use `mkdtempSync` and call `startServer({ ocasDir })` get the FTS5 index "for free" — no signature changes.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. No new top-level dependencies are added (`node:sqlite` is built into Node 22, FTS5 is bundled).
