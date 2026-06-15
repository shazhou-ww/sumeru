---
id: server-search
title: "FTS5 Search"
sources:
  - packages/server/src/search/sqlite-index.ts
  - packages/server/src/search/handler.ts
  - packages/server/src/search/types.ts
  - packages/server/src/search/index.ts
tags: [architecture, server, search, fts5, sqlite]
created: 2026-06-15
updated: 2026-06-15
---

# FTS5 Search

The `packages/server/src/search/` module implements full-text search over session turns using SQLite FTS5. Results are aggregated to session granularity using BM25 scoring.

## HTTP Endpoints

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/sessions?q=...` | Cross-gateway search (optional `?gateway=` filter) |
| GET | `/gateways/:name/sessions?q=...` | Per-gateway search (path gateway is authoritative) |

Both return `@sumeru/search-result` envelopes. The per-gateway route falls through to the `@sumeru/session-list` listing when `?q=` is absent/empty.

### Query Parameters

| Param | Default | Constraints | Notes |
|-------|---------|-------------|-------|
| `q` | (required) | max 1024 chars, non-empty after trim | Wrapped in FTS5 phrase quotes |
| `limit` | 50 | 1–100 (clamped) | |
| `offset` | 0 | ≥ 0 | |
| `gateway` | null | top-level only | Ignored on per-gateway route |

## SQLite Schema

Three tables live in `<ocasDir>/_store.db` (same file as `@ocas/fs` var/tag store, shared via WAL):

### sumeru_turn_index

One row per turn (PK = turn ocas hash):

| Column | Type | Notes |
|--------|------|-------|
| `turn_hash` | TEXT PK | Ocas CAS hash |
| `session_id` | TEXT NOT NULL | Indexed |
| `gateway` | TEXT NOT NULL | Indexed |
| `turn_index` | INTEGER NOT NULL | |
| `role` | TEXT NOT NULL | user / assistant |
| `content` | TEXT NOT NULL | Full turn text |
| `created_at` | TEXT NOT NULL | ISO timestamp |

### sumeru_session_index

One row per session (PK = session id):

| Column | Type | Notes |
|--------|------|-------|
| `session_id` | TEXT PK | |
| `gateway` | TEXT NOT NULL | Indexed |
| `adapter` | TEXT NOT NULL | |
| `status` | TEXT NOT NULL | idle / closed |
| `created_at` | TEXT NOT NULL | |
| `last_active_at` | TEXT NOT NULL | Indexed DESC; bumped on each turn |
| `turn_count` | INTEGER NOT NULL | Incremented on each new turn |

### sumeru_turn_fts

Contentless FTS5 virtual table mirroring `sumeru_turn_index.content`:

```sql
CREATE VIRTUAL TABLE sumeru_turn_fts USING fts5(
  content,
  content='sumeru_turn_index',
  content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
```

Triggers keep it in sync: `AFTER INSERT` and `AFTER DELETE` on `sumeru_turn_index`.

## Search Algorithm

1. **FTS5 MATCH** — query is wrapped in `"..."` (phrase mode, internal `"` doubled) and matched against `sumeru_turn_fts`
2. **BM25 scoring** — SQLite's `bm25()` auxiliary function scores each matching row (lower = better relevance)
3. **Gateway filter** — optional `WHERE t.gateway = ?` applied at the SQL level
4. **Session aggregation** — in JavaScript, deduplicate by `session_id` keeping the best (lowest) BM25 score per session and its snippet
5. **Session metadata join** — fetch `sumeru_session_index` rows for matched session IDs
6. **Sort** — by BM25 score ASC, then `last_active_at` DESC as tie-breaker
7. **Paginate** — apply `offset` and `limit`
8. **Relevance normalization** — `1 / (1 + |score|)` maps to (0, 1] regardless of BM25 sign

### Snippet Generation

Uses FTS5's `snippet()` function:
- Highlight markers: `<<` and `>>`
- Ellipsis: `…`
- Max tokens: 24
- `stripHighlights` option removes markers when needed

## Write Paths

### indexSessionMeta

Called by session store on create. Inserts a row with `status='idle'`, `turn_count=0`. Idempotent (`ON CONFLICT DO NOTHING`).

### indexTurn

Called by SSE message handler for each user/assistant turn. Transactional:
1. Insert turn row (idempotent on `turn_hash`)
2. If new row inserted (`changes > 0`), bump session's `last_active_at` and `turn_count`

### markSessionClosed

Best-effort `UPDATE ... SET status='closed'`. Failures are logged, not propagated.

## SearchIndex Interface

```typescript
type SearchIndex = {
  indexSessionMeta: (meta: SessionMetaInput) => void;
  indexTurn: (input: IndexTurnInput) => void;
  markSessionClosed: (sessionId: string) => void;
  search: (opts: SearchOptions) => SearchResult;
  rebuild: (ocas: SearchRebuildOcas) => void;
  turnCount: () => number;
  close: () => void;
};
```

## Database Connection

- Opens a **second** `DatabaseSync` handle on the same `_store.db` file (safe because WAL mode)
- `PRAGMA journal_mode = WAL` and `PRAGMA foreign_keys = ON`
- Retries up to 3× on `SQLITE_BUSY` with 50ms backoff
- DDL creation wrapped in a transaction

## Idempotency

All write paths use `ON CONFLICT DO NOTHING` on primary keys (turn_hash / session_id). Re-indexing the same CAS node is always a safe no-op. The `rebuild` function wipes both tables and re-indexes from scratch.

## Error Handling

- **Schema creation failure** → throws, blocks server startup
- **Search query failure** → logs warning, returns empty results (no 500)
- **indexTurn failure** → propagates (caller decides: 500 JSON pre-SSE, or SSE error post-SSE)
- **markSessionClosed failure** → logged, not propagated (in-memory status is authoritative)

## Module Exports

`search/index.ts` re-exports:
- HTTP handlers: `handleSearchTopLevel`, `handleSearchPerGateway`, `isSearchRequest`, `parseSearchParams`
- Index operations: `createSearchIndex`, `quoteFtsPhrase`, `rebuildSearchIndex`, `searchSessions`
- Types: `SearchIndex`, `SearchOptions`, `SearchResult`, `SearchHit`, `IndexTurnInput`, `SessionMetaInput`, `SearchRebuildOcas`
