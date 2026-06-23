---
id: server-search
title: "Server Search Index"
sources:
  - packages/server/src/search/sqlite-index.ts
  - packages/server/src/ocas/index.ts
  - packages/server/tests/rebuild-search-index-walk.test.ts
tags: [architecture, server, search, fts5, sqlite]
created: 2026-06-15
updated: 2026-06-23
---

# Server Search Index

Server search uses a SQLite FTS5 index in `<ocasDir>/_store.db` and exposes rebuild operations that now walk OCAS directly.

## Core Tables

`createSearchIndex` ensures these tables exist:

- `sumeru_turn_index` (turn rows keyed by `turn_hash`)
- `sumeru_turn_fts` (FTS5 virtual table over turn content)
- `sumeru_session_index` (session metadata/status/counters, includes nullable `meta_hash`)
- `sumeru_session_turns` (durable ordered turn pointers per session)

Important: `sumeru_session_turns` is not owned by FTS and is intentionally preserved during rebuild.

## Index Write APIs

`SearchIndex` includes:

- `indexSessionMeta`
- `indexTurn`
- `markSessionClosed`
- `appendSessionTurn`
- `listSessionTurns`
- `loadSessionTurnsBulk`
- `loadSessionRows`
- `search`
- `rebuild`
- `turnCount`

This supports both online indexing and startup rehydration of session state.

## Rebuild Behavior (Updated)

`rebuildSearchIndex(index, ocas)` now requires only two arguments and delegates to `index.rebuild(ocas)`.

Rebuild flow in `sqlite-index.ts`:

1. Read `sumeru_session_turns` first to build `turnHash -> sessionId` associations.
2. Clear only FTS-owned tables (`sumeru_turn_index`, `sumeru_session_index`).
3. Enumerate OCAS session-meta nodes via `store.cas.listByType(sessionMetaSchemaHash)`.
4. Re-index session rows and build `sessionId -> gateway` map.
5. Enumerate OCAS turn nodes via `store.cas.listByType(turnSchemaHash)`.
6. Re-index turns by joining:
   - turn hash -> session id (from durable pointer table)
   - session id -> gateway (from indexed session-meta)
7. Skip orphaned turns with warnings instead of failing.
8. Run corrective UPDATE to recompute `turn_count` and `last_active_at` from indexed turns.

So rebuild source-of-truth is OCAS CAS nodes plus durable `sumeru_session_turns`, not caller-provided root sets.

## Migration Note

`migrateMetaHashColumn` adds `meta_hash` to older `sumeru_session_index` schemas when absent, preserving compatibility with pre-column databases.

## Test Coverage

`rebuild-search-index-walk.test.ts` verifies:

- two-arg rebuild restores search hits after index-table wipe
- rebuild idempotency across repeated runs
- orphaned turns are skipped with warning, not crash
- session-meta indexing occurs before turn indexing assumptions

This locks the new walk-based rebuild semantics.
