---
scenario: "The shared _store.db gains a durable per-session ordered turn-list table plus a meta_hash column on sumeru_session_index, created idempotently at boot so the session store can rehydrate turnHashes from disk"
feature: server-ocas
tags: [ocas, sqlite, schema, migration, session, turn, persistence, phase-6, refs-399]
---

## Given
- `server-session-turnhashes-persistence.md` requires a durable, ordered, per-session list of turn hashes that survives restart, reusing the existing `<ocasDir>/_store.db` SQLite database.
- That DB is opened and owned today by `createSearchIndex(dbPath)` in `packages/server/src/search/sqlite-index.ts`. It already defines, via one `SCHEMA_DDL` string executed in a `BEGIN/COMMIT` at open:
  - `sumeru_turn_index(turn_hash PK, session_id, gateway, turn_index, role, content, created_at)`
  - `sumeru_session_index(session_id PK, gateway, adapter, status, created_at, last_active_at, turn_count)`
  - `sumeru_turn_fts` (contentless FTS5) + insert/delete triggers.
- All schema statements in `SCHEMA_DDL` use `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`, so re-opening an existing DB is a safe no-op. The same idempotent style MUST be used for the additions below.
- `sumeru_turn_index` ALREADY has enough to reconstruct an ordered list per session (`session_id`, `turn_index`, `turn_hash`). However, it is a SEARCH index — its rows can be deleted/rebuilt by `rebuild()` (`DELETE FROM sumeru_turn_index`), and it is conceptually owned by FTS. Relying on it as the canonical list pointer couples persistence to the search index's lifecycle. This spec therefore introduces a DEDICATED list-pointer table so the turn-list survives an FTS `rebuild` and has clear ownership. (Reading the list from `sumeru_turn_index` is an acceptable fallback ONLY if the implementer also guarantees `rebuild` never drops it; the dedicated table is the preferred, less-coupled design.)

## When
- A server boots against `--ocas-dir <DIR>` for the first time (fresh DB), then a turn is appended (`appendTurnHash`), then the process restarts against the same `<DIR>` and the session store rehydrates.
- Separately, a server boots against an OLDER `<DIR>` whose `_store.db` predates these additions (has `sumeru_session_index` WITHOUT `meta_hash`, and no list-pointer table).

## Then
- **New table `sumeru_session_turns`** — created `IF NOT EXISTS` as part of the same boot-time DDL transaction:
  ```sql
  CREATE TABLE IF NOT EXISTS sumeru_session_turns (
    session_id  TEXT NOT NULL,
    turn_index  INTEGER NOT NULL,
    turn_hash   TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_index)
  );
  CREATE INDEX IF NOT EXISTS idx_sumeru_session_turns_session
    ON sumeru_session_turns(session_id);
  ```
  - `PRIMARY KEY (session_id, turn_index)` makes the append idempotent per position and enforces one hash per ordered slot.
  - Ordering for rehydration is `ORDER BY turn_index ASC`.
  - This table is NOT touched by the FTS `rebuild()` path (`rebuild` only clears `sumeru_turn_index` + `sumeru_session_index`); the turn-list pointer is durable independent of search re-indexing.
- **Append write** — a prepared statement, used by `SessionStore.appendTurnHash`:
  ```sql
  INSERT INTO sumeru_session_turns (session_id, turn_index, turn_hash)
  VALUES (?, ?, ?)
  ON CONFLICT(session_id, turn_index) DO NOTHING
  ```
  - `turn_index` is the 0-based append position (= `turnHashes.length` before the push).
  - `ON CONFLICT … DO NOTHING` matches the existing idempotency convention used by `insertTurn` / `insertSession`.
- **Read API for rehydration** — a function returning the ordered hashes for one session, plus a bulk variant for boot:
  - `listSessionTurns(sessionId): Hash[]` → `SELECT turn_hash FROM sumeru_session_turns WHERE session_id = ? ORDER BY turn_index ASC`.
  - A bulk loader used at construction reads all rows grouped by `session_id` (single query `SELECT session_id, turn_hash FROM sumeru_session_turns ORDER BY session_id, turn_index ASC`) so rehydration is O(1) queries, not O(sessions).
  - These are exposed as named functions on the same closure that owns the DB handle (the persistence/search module), reusing the ONE existing `DatabaseSync` handle — no second/third handle is opened.
- **`meta_hash` column on `sumeru_session_index`** — so rehydration can recover each session's `config` (and `metaHash`) from the immutable ocas `@sumeru/session-meta` node:
  - On a FRESH DB the column is part of the `CREATE TABLE` definition:
    ```sql
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
    ```
  - On an EXISTING DB the column is added by a guarded migration at open: detect via `PRAGMA table_info(sumeru_session_index)`; if `meta_hash` is absent, run `ALTER TABLE sumeru_session_index ADD COLUMN meta_hash TEXT`. (SQLite cannot `ADD COLUMN IF NOT EXISTS`, so the pragma check is required.) The migration runs inside the open transaction and is a no-op when the column already exists.
  - `meta_hash` is nullable (`TEXT`, no `NOT NULL`) so old rows that predate it load as `null` without error. When `null`, rehydration falls back to `config: {}` and logs a structured warning (per the persistence spec). New sessions populate it: `indexSessionMeta` (or a small extension of it) writes `meta_hash` alongside the existing columns when a session is first indexed.
  - `indexSessionMeta`'s `SessionMetaInput` gains a `metaHash: Hash` field (per CLAUDE.md, a required field, not optional) so the insert can persist it. The session store already has `metaHash` at `create` time (it is the return of `recordPayload(...)`), so threading it through is a local change.
- **Boot-time rebuild of `sumeru_turn_fts`** is NOT required by this change (the FTS triggers already mirror `sumeru_turn_index`); this spec only adds a sibling list table and one nullable column.
- **Idempotency / safety** —
  - Re-opening a DB that already has `sumeru_session_turns` and `meta_hash` is a clean no-op (all `IF NOT EXISTS` + pragma-guarded ALTER).
  - The additions are wrapped in the SAME `BEGIN … COMMIT` (with `ROLLBACK` on error) that `createSearchIndex` already uses, so a failure mid-migration leaves the DB unchanged and surfaces as the existing `failed to create FTS5 index: <cause>` boot error (the open path already maps DB failures into the `failed to open ocas store at <dir>:` prefix in `openSumeruOcas`).

## Tests
- **Schema presence** (`packages/server/tests/session-turns-table.test.ts`):
  - Open a fresh `_store.db` via the normal boot path; assert `sumeru_session_turns` exists (`SELECT name FROM sqlite_master WHERE type='table' AND name='sumeru_session_turns'` returns a row) and has the `(session_id, turn_index)` primary key (via `PRAGMA table_info`).
  - Assert `sumeru_session_index` has a `meta_hash` column (`PRAGMA table_info(sumeru_session_index)` includes it).
- **Migration on legacy DB**:
  - Hand-craft a DB containing a `sumeru_session_index` WITHOUT `meta_hash` (run the old DDL), close it, then open it through the current boot path.
  - Assert the open does NOT throw and that `meta_hash` is present afterward (pragma check). A pre-existing session row survives the `ALTER` with `meta_hash = NULL`.
- **Append + read round-trip**:
  - Insert three rows for one `session_id` at indices 0,1,2 via the append statement; `listSessionTurns(sessionId)` returns the three hashes in index order.
  - Re-insert index 1 with a different hash → `ON CONFLICT DO NOTHING` keeps the original; the list is unchanged (idempotent).
  - The bulk loader groups multiple sessions correctly and orders each group by `turn_index ASC`.
- **`rebuild` independence**: populate `sumeru_session_turns`, then call the FTS `rebuild()` path; assert `sumeru_session_turns` rows are untouched (turn-list pointer is not search-owned).
- All existing `search-index.test.ts` / `ocas-*.test.ts` continue to pass; the new column and table are additive and do not alter FTS query results or existing inserts.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.

## Constraints (implementation discipline — from CLAUDE.md)
- `type` over `interface`; `function` + closures over `class` (extend the existing `createSearchIndex` closure or add a sibling persistence closure on the same DB handle).
- Folder module discipline: re-export new functions through the module's `index.ts` (pure re-exports); declare new input types (`metaHash` on `SessionMetaInput`, any new row types) in the module's `types.ts`.
- Named exports only; ESM `.js` import specifiers; no default exports.
- No optional properties: new fields are `T | null` (nullable column maps to `string | null`), never `?:`.
- Structured logging with the existing `[sumeru]` prefix; no bare `console.log`.
- Reuse the single existing `DatabaseSync` handle — do NOT open another connection to `_store.db`.
