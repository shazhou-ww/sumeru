---
"@sumeru/server": minor
---

Phase 5: session search + export.

- New SQLite FTS5 search index (`packages/server/src/search/`) backed by a
  second `node:sqlite` handle on `<ocasDir>/_store.db` — the same file
  `@ocas/fs` uses for vars/tags. Schema is bootstrapped on first open via
  `createSearchIndex(dbPath)`. Tables: `sumeru_turn_index` (one row per
  turn), contentless `sumeru_turn_fts` (FTS5 with `unicode61` tokenizer
  for CJK), and `sumeru_session_index` (per-session denormalized state).
  AFTER INSERT/DELETE triggers keep the FTS5 mirror in lockstep with the
  index table. All indexing paths are idempotent on the turn hash /
  session id, so re-indexing is a no-op.
- `openSumeruOcas(dir)` now also opens the search index; `SumeruOcas`
  exposes `searchIndex: SearchIndex` alongside the store. Session
  create/close and turn write paths transparently feed the index — no
  caller changes required for Phase 1-4 code.
- New endpoint `GET /sessions?q=<query>` performs cross-gateway search;
  `GET /gateways/:name/sessions?q=<query>` extends the Phase 2 list
  endpoint with per-gateway search. Both return a
  `@sumeru/search-result` envelope `{ query, gateway, total, offset,
  limit, results: SearchResultHit[] }` ordered by BM25 (best first).
  Supports `?gateway=<name>`, `?limit` (default 50, cap 100), `?offset`
  (default 0). Empty/whitespace `q` on top-level → `400 invalid_request`;
  on per-gateway → falls through to the existing Phase 2 session list.
  Each hit carries `relevance` normalized to `(0, 1]` via
  `1 / (1 + |bm25|)` and a `matchContext` snippet with `<<...>>` markers.
- New endpoint `POST /gateways/:name/sessions/:id/export` returns the
  session's full recording (session-meta + every turn + their schema
  chain) as a self-contained `tar.gz`, built via
  `@ocas/core.exportBundle`. Headers: `Content-Type: application/gzip`,
  `Content-Disposition: attachment; filename="<sessionId>.tar.gz"`,
  `Cache-Control: no-store`, `X-Sumeru-Export-Nodes`,
  `X-Sumeru-Export-Session`, `Content-Length`. NO `Content-Encoding`
  (gzip is the payload format, not transport encoding). Closed and
  empty sessions are exportable. `HEAD` returns the same headers with
  an empty body. Temp-dir cleanup runs on response `finish` AND `close`,
  so client disconnects do not leak.
- `quoteFtsPhrase(raw)`, `searchSessions(index, opts)`, and
  `rebuildSearchIndex(index, ocas, roots)` are exported from
  `@sumeru/server` for tooling and tests.
- `README.md` HTTP table gains rows for the new search and export
  endpoints, and the Recording section gets a one-line note about
  `ocas import` round-tripping.
