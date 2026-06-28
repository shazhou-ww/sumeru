---
scenario: "GET /sessions?q=<query> and GET /gateways/:name/sessions?q=<query> run an FTS5 search over recorded turn content and return a `@sumeru/search-result` envelope sorted by relevance"
feature: server-http
tags: [http, search, fts5, session, envelope, phase-5]
---

## Given
- Phase-5 FTS5 index is in place per `server-fts5-index.md`: every recorded `@sumeru/turn` is indexed in `sumeru_turn_fts` and every session has a row in `sumeru_session_index`. The index is the data source for these endpoints — this spec covers the HTTP wire contract.
- The server is running:
  ```
  sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml --ocas-dir <tmpdir>
  ```
  with two gateways declared: `hermes` and `claude-code`.
- The following sessions and content exist (created via `POST .../sessions` then `POST .../sessions/:id/messages` per Phase 3/4):
  | Session | Gateway       | Sample turn content (assistant or user)                                |
  |---------|---------------|-------------------------------------------------------------------------|
  | A       | hermes        | "请修复 login 页面的重定向问题"                                          |
  | B       | hermes        | "let me look at the login redirect…"                                    |
  | C       | hermes        | "deploy pipeline timeout"                                               |
  | D       | claude-code   | "refactor login form to use new auth"                                   |
  | E       | claude-code   | "small typo fix in README"                                              |
- The architecture spec declares the response shape (`specs/architecture.md` → "Session 搜索"):
  ```json
  {
    "type": "@sumeru/search-result",
    "value": {
      "query": "login重定向",
      "results": [
        {
          "id": "ses_<...>",
          "gateway": "hermes",
          "status": "idle",
          "relevance": 0.87,
          "matchContext": "我来看一下 login 页面的重定向问题…",
          "turns": 12,
          "lastActiveAt": "2026-06-13T12:05:00Z"
        }
      ]
    }
  }
  ```
- The route `GET /sessions` is **new** to Phase 5 — Phase 1-4 had no top-level `/sessions` route; the only listing was per-gateway. The route `GET /gateways/:name/sessions` already exists (Phase 2) but Phase 2 ignored all query params (`server-sessions-list-endpoint.md` Request 6). Phase 5 makes `?q=<non-empty>` switch the response from `@sumeru/session-list` to `@sumeru/search-result`.

## When
- The client issues each of the following in order:
  1. `curl -fsS -i 'http://127.0.0.1:<port>/sessions?q=login'`                                  # cross-gateway
  2. `curl -fsS -i 'http://127.0.0.1:<port>/sessions?q=login&limit=2'`                          # cross + limit
  3. `curl -fsS -i 'http://127.0.0.1:<port>/sessions?q=login&offset=1&limit=2'`                 # cross + page 2
  4. `curl -fsS -i 'http://127.0.0.1:<port>/sessions?q=login&gateway=claude-code'`              # explicit gateway filter
  5. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions?q=login'`                  # per-gateway
  6. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/claude-code/sessions?q=login'`             # per-gateway, other side
  7. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions'`                          # NO q → Phase-2 list (unchanged)
  8. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions?q='`                       # empty q
  9. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions?q=%20%20'`                 # whitespace-only q
  10. `curl -fsS -i 'http://127.0.0.1:<port>/sessions?q='`                                       # empty q on top-level
  11. `curl -fsS -i 'http://127.0.0.1:<port>/sessions'`                                          # NO q on top-level
  12. `curl -fsS -i 'http://127.0.0.1:<port>/sessions?q=login%E9%87%8D%E5%AE%9A%E5%90%91'`       # CJK/UTF-8 query "login重定向"
  13. `curl -sS  -i 'http://127.0.0.1:<port>/sessions?q=login&limit=abc'`                        # invalid limit
  14. `curl -sS  -i 'http://127.0.0.1:<port>/sessions?q=login&limit=-1'`                         # negative limit
  15. `curl -sS  -i 'http://127.0.0.1:<port>/sessions?q=login&limit=999'`                        # over cap
  16. `curl -sS  -i 'http://127.0.0.1:<port>/sessions?q=login&offset=abc'`                       # invalid offset
  17. `curl -sS  -i 'http://127.0.0.1:<port>/sessions?q=login&gateway=does-not-exist'`           # unknown gateway filter
  18. `curl -sS  -i -X POST 'http://127.0.0.1:<port>/sessions?q=login'`                          # disallowed method
  19. `curl -sS  -i 'http://127.0.0.1:<port>/sessions?q='"$(python3 -c 'print("x"*8000)')"'  '`  # very long q
  20. `curl -fsS -i 'http://127.0.0.1:<port>/sessions/'`                                          # trailing slash, no q
  21. `curl -fsS -i 'http://127.0.0.1:<port>/sessions/?q=login'`                                  # trailing slash, with q

## Then
- **Request 1 — cross-gateway happy path** —
  - HTTP `200 OK`, `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`.
  - Body:
    ```json
    {
      "type": "@sumeru/search-result",
      "value": {
        "query": "login",
        "gateway": null,
        "total": 3,
        "offset": 0,
        "limit": 50,
        "results": [
          { "id": "ses_<A>", "gateway": "hermes",      "status": "idle", "relevance": 0.91, "matchContext": "...请修复 <<login>> 页面的...", "turns": <int>, "lastActiveAt": "<iso>" },
          { "id": "ses_<B>", "gateway": "hermes",      "status": "idle", "relevance": 0.78, "matchContext": "...look at the <<login>> redirect...", "turns": <int>, "lastActiveAt": "<iso>" },
          { "id": "ses_<D>", "gateway": "claude-code", "status": "idle", "relevance": 0.55, "matchContext": "...refactor <<login>> form...",         "turns": <int>, "lastActiveAt": "<iso>" }
        ]
      }
    }
    ```
  - **Top-level keys** are exactly `type` and `value`. `value` keys are exactly `query`, `gateway`, `total`, `offset`, `limit`, `results` — six keys, no more, no less.
  - **`query`** is the trimmed user input (`login`), NOT the URL-decoded raw form (the server trims surrounding whitespace before echoing). Tests verify with `?q=%20login%20`.
  - **`gateway`** is `null` for the top-level route; `"hermes"` / `"claude-code"` for per-gateway routes; or the value of `?gateway=` when the cross-gateway route has the filter applied (Request 4). The field is always present.
  - **`total`** is the count of distinct sessions whose turns match the query (NOT the count of matching turns). Tests on the fixture above: `total = 3` (sessions A, B, D each contain "login").
  - **`offset`** and **`limit`** are echoed (defaults: `offset=0`, `limit=50`).
  - **`results`** is an array of hits ordered by `relevance` descending (BM25-derived per `server-fts5-index.md`); ties broken by `lastActiveAt` descending. Each hit has exactly seven keys: `id`, `gateway`, `status`, `relevance`, `matchContext`, `turns`, `lastActiveAt`. Hit object key order is fixed.
  - **`relevance`** is a number in `(0, 1]`. Tests assert each hit's value, the strict ordering invariant, and that no two hits for the same session_id appear (de-dup is enforced server-side per `server-fts5-index.md`).
  - **`matchContext`** is a snippet from the best-matching turn for the session, ≤ 240 chars. The test assertion strips `<<` `>>` markers (FTS5 `snippet()` highlight tokens) before comparing to expected substrings. Empty string is NEVER returned (a hit always has at least one matched token by definition).
  - **`turns`** is the session's recorded turn count (`sumeru_session_index.turn_count`).
  - **`lastActiveAt`** is the timestamp of the most recent indexed turn for the session.
  - The list **includes `closed` sessions** when their turns match the query — search is over recorded content, not over current state. Tests close session B and verify it still appears with `status: "closed"`.
- **Request 2 — `?limit=2`** — HTTP `200`, `value.results.length === 2`, `value.total === 3`, `value.limit === 2`, `value.offset === 0`. Top-2 hits by relevance are returned.
- **Request 3 — `?offset=1&limit=2`** — HTTP `200`, `value.results.length === 2`, `value.total === 3`, `value.limit === 2`, `value.offset === 1`. Returns hits at positions 1 and 2 (zero-indexed) of the relevance-ordered list.
- **Request 4 — `?gateway=claude-code`** — HTTP `200`, `value.gateway === "claude-code"`, `value.total === 1`, `value.results[0].id === "ses_<D>"` and every `results[*].gateway === "claude-code"`. The `gateway` query param is honored on the top-level route AS A FILTER (no 404 on unknown gateway in this query-param form — see Request 17 for the trade-off and choice).
- **Request 5 — `/gateways/hermes/sessions?q=login`** — HTTP `200`, `value.gateway === "hermes"`, `value.total === 2`, results contain only sessions A and B (in relevance order). Hits from `claude-code` are absent.
- **Request 6 — `/gateways/claude-code/sessions?q=login`** — HTTP `200`, `value.gateway === "claude-code"`, `value.total === 1`, results contain only session D.
- **Request 7 — `/gateways/hermes/sessions` with NO q** — HTTP `200`, body is the **Phase-2 `@sumeru/session-list` envelope** (entries A, B, C in createdAt order — see `server-sessions-list-endpoint.md`). The Phase-5 contract changes ONLY when `?q=` is present and non-empty after trimming. This preserves backward compatibility with all Phase-2 callers.
- **Request 8 — `?q=` (empty after `=`)** — HTTP `200`, body is the **Phase-2 `@sumeru/session-list`**. Treating empty `q` as "no search" is intentional: it's the natural fallback when a UI clears the search box, and avoids a noisy 400.
- **Request 9 — `?q=%20%20` (whitespace only)** — HTTP `200`, body is the Phase-2 `@sumeru/session-list`. Same rule: trimmed-empty queries fall through to the list endpoint. Tests assert `value.type === "@sumeru/session-list"` (NOT `@sumeru/search-result`).
- **Request 10 — top-level `?q=`** — HTTP `400 Bad Request`, `@sumeru/error` envelope, `value.error: "invalid_request"`, `value.message: "Query parameter 'q' is required and must be a non-empty string"`. The top-level `/sessions` route does NOT have a fallback — without `q`, there is nothing meaningful to return (cross-gateway listing is out of scope; explicit `gateway=` is allowed but never the only param). Tests assert this is a hard error to keep the cross-gateway endpoint's contract narrow.
- **Request 11 — top-level no q at all** — HTTP `400`, identical to Request 10.
- **Request 12 — CJK/UTF-8 `login重定向`** — HTTP `200`, `value.query === "login重定向"` (UTF-8 round-trip is exact). Whether the FTS5 tokenizer finds matches depends on the index contents (per `server-fts5-index.md`, `unicode61` tokenizes CJK by character — `login重定向` becomes the tokens `login`, `重`, `定`, `向`); for the fixture above, session A matches because its content includes `login`, `重`, `定`, and `向`. Test asserts `value.results[0].id === "ses_<A>"` and `relevance > 0`.
- **Request 13 — `?limit=abc`** — HTTP `400`, `value.error: "invalid_request"`, `value.message: "Query parameter 'limit' must be a non-negative integer (got 'abc')"`. Same wording as `server-message-history-endpoint.md` (consistency across endpoints).
- **Request 14 — `?limit=-1`** — HTTP `400`, identical wording with `'-1'` substituted.
- **Request 15 — `?limit=999`** — HTTP `200`, `value.limit === 100`, `value.results.length` ≤ 100. The cap is `100` (smaller than the history endpoint's `1000` cap because search results carry per-row matchContext and are heavier). Echoed `limit` reflects the cap, NOT the requested value (consistent with `server-message-history-endpoint.md`'s `?limit=99999` cap behavior — though the cap value differs).
- **Request 16 — `?offset=abc`** — HTTP `400`, analogous to Request 13 with `offset` substituted.
- **Request 17 — `?gateway=does-not-exist` on top-level** — HTTP `200`, `value.gateway === "does-not-exist"`, `value.total === 0`, `value.results === []`. **Rationale:** an unknown gateway on a query-param filter is a search predicate; "no sessions match because no such gateway has anything indexed" is the honest answer. Returning 404 here would conflate filter-predicate-no-results with route-not-found. (The PER-GATEWAY route — `/gateways/<unknown>/sessions?q=login` — DOES return 404 `gateway_not_found` per the existing Phase-2 contract; that route's gateway is structural, not a filter.)
- **Request 18 — `POST /sessions?q=login`** — HTTP `405 Method Not Allowed`, `Allow: GET`, `@sumeru/error` envelope. Only `GET` (and implicit `HEAD`) work on `/sessions`.
- **Request 19 — very long q** — HTTP `400`, `value.error: "invalid_request"`, `value.message: "Query parameter 'q' must be at most 1024 characters"`. The cap protects FTS5 from pathological inputs and keeps log lines bounded.
- **Request 20 — `/sessions/` no q** — HTTP `400`, identical to Request 11. Trailing slash is normalized.
- **Request 21 — `/sessions/?q=login`** — HTTP `200`, body identical to Request 1. Trailing slash is normalized.
- **Per-gateway unknown gateway** — `GET /gateways/does-not-exist/sessions?q=login` returns HTTP `404`, `value.error: "gateway_not_found"` (Phase-2 behavior is preserved). The 404 is decided BEFORE any FTS5 query.
- **Per-gateway with `?gateway=`** — `GET /gateways/hermes/sessions?q=login&gateway=claude-code` ignores the `gateway=` query param (the URL path is authoritative for the per-gateway route). Test asserts results only contain `gateway: "hermes"`.
- **Method enforcement on the per-gateway `/sessions` route with `q`** — `POST` to `/gateways/hermes/sessions` is **already** the create-session route (Phase 2) — `?q=...` does NOT change that. A `POST .../sessions?q=login` body therefore goes through the create-session path; the `?q=` is silently ignored on POST. Tests assert: `POST .../sessions?q=login` with body `{}` returns 201 + `@sumeru/session` envelope as in Phase 2; the `q` is NOT echoed and no search is performed.
- **`HEAD`** — `HEAD /sessions?q=login` and `HEAD /gateways/:name/sessions?q=login` return the same status and headers as the corresponding `GET`, with empty body. Tests assert `Content-Length` matches the GET body's length.
- **Closed sessions** — A session whose status is `closed` (because of `DELETE`) still appears in search results when its content matches. `value.results[*].status` reflects the current in-memory status, NOT the indexed status. Tests close a matching session AFTER indexing and verify the result row shows `"closed"`.
- **No active sessions / empty store** — `/sessions?q=login` against a store with zero indexed turns returns HTTP `200`, `value.total: 0`, `value.results: []`, `value.query: "login"`, `value.gateway: null`. Empty array — never `null`, never 404.
- **Concurrency / index-while-search** — A `GET /sessions?q=...` issued during a `POST .../messages` mid-flight returns whatever turns have been indexed at the moment of the SQL query. The server uses a single SQLite handle (per `server-fts5-index.md`); SQLite's WAL mode (already enabled by `@ocas/fs.createSqliteVarStore`) lets the SELECT see a consistent snapshot.
- **Query-param parsing** — `URLSearchParams` is used; duplicate `?q=foo&q=bar` takes the **first** value (`foo`) — matches Express/Hono default. Tests assert this explicitly. Same rule for `gateway`, `limit`, `offset`.
- **Wire envelope helper** — `packages/server/src/envelope.ts` gains `searchResultEnvelope(value)` returning `{ type: "@sumeru/search-result", value }`. Reused by both routes.
- **OpenAPI / README updates** — `README.md`'s HTTP table gains a row for `GET /sessions` → `@sumeru/search-result`. The architecture spec is the source of truth and is unchanged. (No machine-readable schema is published yet.)
- **Tests** under `packages/server/tests/search-endpoint.test.ts`:
  - **Happy path** — Build the fixture above (5 sessions), then issue all 21 requests via the in-process server. Assert HTTP status, `Content-Type`, top-level envelope, `value` keys, ordering, and key counts.
  - **Type vs list dispatch** — Assert `?q=` (empty/whitespace) on `/gateways/hermes/sessions` returns the Phase-2 `@sumeru/session-list` (envelope type check), while `?q=login` returns `@sumeru/search-result`.
  - **Phase-2 regression** — Re-run a subset of `server-sessions-list-endpoint.md` requests to assert NONE of them changed: empty list, multi-session list with order, list including a closed session, per-gateway scoping, unknown gateway 404, 405 on `DELETE` at collection, trailing-slash normalization. (Phase-5 only adds; never subtracts.)
  - **POST + ?q ignored** — `POST /gateways/hermes/sessions?q=login` with body `{}` returns 201 `@sumeru/session`; no search-related fields in the response.
  - **`HEAD`** — same status/headers as GET, empty body, correct `Content-Length`.
  - **Method 405** — `POST /sessions?q=login` → 405, `Allow: GET`. `PUT` / `PATCH` / `DELETE` same.
  - **Pagination** — Assert disjoint coverage: results from `offset=0, limit=2` ∪ results from `offset=2, limit=10` == full result set when `total > 2`.
  - **Bad params** — Each of the 400 cases in Requests 10/11/13/14/16/19 has the exact `error` code and `message` substring asserted.
  - **Cap on `limit`** — `?limit=999` returns at most 100 results AND echoes `limit: 100`.
  - **`?gateway=` filter** — Both unknown (Request 17 → empty 200) and known (Request 4 → filtered 200).
  - **CJK** — Request 12 returns the right session and a non-zero relevance.
  - **Closed session in results** — Close session B, search `?q=login`, assert B appears with `status: "closed"`.
  - **No store contamination** — A test that runs Phase-1 / Phase-2 / Phase-3 / Phase-4 / Phase-5 endpoints sequentially against a single tmpdir asserts each endpoint's contract independently (catches accidental shared state).
- All Phase-1/2/3/4 tests continue to pass unchanged.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
