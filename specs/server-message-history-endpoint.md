---
scenario: "GET /gateways/:name/sessions/:id/messages returns the full ordered turn sequence for a session, sourced from ocas via the per-session turnHashes pointer"
feature: server-http
tags: [http, message, history, ocas, envelope, phase-4]
---

## Given
- Phase-4 turn recording is in place (`server-ocas-turn-recording.md`).
- Session `ses_<X>` on gateway `hermes` has had three sends: the resulting `Session.turnHashes` is `[h1, h2, h3, h4, h5, h6]` where:
  - `h1` = user turn 0, `h2` = assistant turn 1
  - `h3` = user turn 2, `h4` = assistant turn 3, `h5` = assistant turn 4 (a 2-turn assistant response)
  - `h6` = user turn 5 (an in-progress send — but for this spec assume the third send completed with `h6` = user turn 5, `h7` = assistant turn 6 — adjust mentally; tests use a deterministic fixture).
- The route `GET /gateways/:name/sessions/:id/messages` was reserved by Phase 3 (the SSE endpoint is `POST` only). Phase 4 implements the GET.

## When
- The client issues each of the following:
  1. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages`                     # full history
  2. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages?offset=2&limit=3'`  # paginated
  3. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages?limit=0'`           # zero limit
  4. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages?offset=999'`        # offset past end
  5. `curl -sS  -i 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages?limit=-1'`          # invalid
  6. `curl -sS  -i 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages?limit=abc'`         # invalid
  7. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_DOES_NOT_EXIST/messages`          # unknown id
  8. `curl -fsS -i http://127.0.0.1:<port>/gateways/does-not-exist/sessions/ses_<X>/messages`             # unknown gateway
  9. `curl -fsS -i -X POST -H 'Content-Type: application/json' -d '{"content":"hi"}' http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/messages`  # POST still works

## Then
- **Request 1 — full history** —
  - HTTP `200 OK`, `Content-Type: application/json; charset=utf-8`.
  - Body:
    ```json
    {
      "type": "@sumeru/message-history",
      "value": {
        "sessionId": "ses_<X>",
        "gateway": "hermes",
        "total": 7,
        "offset": 0,
        "limit": 7,
        "turns": [
          { "index": 0, "role": "user",      "content": "<...>", "timestamp": "<iso>", "toolCalls": null,        "hash": "<h1>" },
          { "index": 1, "role": "assistant", "content": "<...>", "timestamp": "<iso>", "toolCalls": [...],       "tokens": {"input": 100, "output": 20}, "hash": "<h2>" },
          { "index": 2, "role": "user",      "content": "<...>", "timestamp": "<iso>", "toolCalls": null,        "hash": "<h3>" },
          { "index": 3, "role": "assistant", "content": "<...>", "timestamp": "<iso>", "toolCalls": [...],       "hash": "<h4>" },
          { "index": 4, "role": "assistant", "content": "<...>", "timestamp": "<iso>", "toolCalls": null,        "hash": "<h5>" },
          { "index": 5, "role": "user",      "content": "<...>", "timestamp": "<iso>", "toolCalls": null,        "hash": "<h6>" },
          { "index": 6, "role": "assistant", "content": "<...>", "timestamp": "<iso>", "toolCalls": null,        "hash": "<h7>" }
        ]
      }
    }
    ```
  - `turns` is the full ordered sequence (oldest first), reconstructed by:
    1. Reading `Session.turnHashes` (in-order list).
    2. For each hash, `store.get(hash)` returns the CAS node; the payload is the `Turn` body.
    3. The server appends a `hash` field to each turn (matching `server-ocas-turn-recording.md`'s SSE shape).
  - `total` is the length of `turnHashes` for the session at the time of the request.
  - `offset` (default `0`) and `limit` (default = `total - offset`, capped at `1000` to avoid runaway responses) are echoed in the response so clients can paginate without re-counting.
  - The order is **strictly ascending by `Turn.index`**, which matches the order in `Session.turnHashes`. The endpoint does NOT sort by timestamp (timestamp is informational, not a sort key — adapter clock skew is possible).
  - Closed sessions ARE addressable by this endpoint — closing does not erase history. (Architecture spec: "关闭后消息历史仍可读取.")
- **Request 2 — pagination** —
  - `?offset=2&limit=3` returns:
    ```json
    {
      "type": "@sumeru/message-history",
      "value": {
        "sessionId": "ses_<X>",
        "gateway": "hermes",
        "total": 7,
        "offset": 2,
        "limit": 3,
        "turns": [<turn[2]>, <turn[3]>, <turn[4]>]
      }
    }
    ```
  - When `offset + limit` > `total`, `turns` simply has fewer entries; `limit` is echoed as the requested value (NOT clamped). Tests assert this.
- **Request 3 — `limit=0`** — HTTP `200`, `value.turns: []`, `value.total: 7`, `value.offset: 0`, `value.limit: 0`. Useful as a "fast count" probe.
- **Request 4 — offset past end** — HTTP `200`, `value.turns: []`, `value.total: 7`, `value.offset: 999`, `value.limit: <whatever-you-passed-or-defaulted>`.
- **Request 5 — `limit=-1`** — HTTP `400 Bad Request`, `@sumeru/error` envelope, `value.error: "invalid_request"`, `value.message: "Query parameter 'limit' must be a non-negative integer (got '-1')"`.
- **Request 6 — `limit=abc`** — HTTP `400`, `value.error: "invalid_request"`, `value.message: "Query parameter 'limit' must be a non-negative integer (got 'abc')"`. Same error code as Request 5.
- **`offset` validation** — Same rules as `limit`: non-negative integer or 400 with the analogous message. `offset=0` is valid (and is the default).
- **`limit` cap** — When `?limit=99999` is passed, the server caps at `1000` and echoes `limit: 1000` in the response (the actual page size). Documented in the response so clients know to paginate.
- **Request 7 — unknown session** — HTTP `404`, `value.error: "session_not_found"` (same code as Phase-2 detail endpoint).
- **Request 8 — unknown gateway** — HTTP `404`, `value.error: "gateway_not_found"`.
- **Request 9 — POST still works** — Phase-3 SSE behavior (turn / heartbeat / done) is preserved on `POST` to the same path. The Allow header on a `PUT` to this path is `Allow: GET, POST` (Phase 3 allowed `GET, POST` already; Phase 4 just makes `GET` actually do something).
- **Method enforcement on `PUT`/`PATCH`/`DELETE`** — `405 method_not_allowed` with `Allow: GET, POST`.
- **Trailing slash** — `/messages/` is normalized identically to `/messages`. `?offset=0` and `?` (empty query) are equivalent.
- **CORS / headers** — `Cache-Control: no-store` (history is mutable as new sends land). `Vary: Accept` reserved for future content-negotiation; not required to be set in Phase 4.
- **Performance / N+1** —
  - The implementation uses a single `Session.turnHashes` lookup followed by `turnHashes.length` `store.get(hash)` calls. `@ocas/fs.createFsStore` keeps an in-memory hash set; `get` is O(1) for cache hits and one `readFileSync` for cold reads. Phase 4 does not introduce a bulk-get API to ocas; one-by-one is acceptable for the issue's MVP scope.
  - Test asserts the endpoint completes in < 1 s for a 100-turn fixture (loose bound — guards against accidental quadratic loops).
- **Concurrency** — A `GET` issued while a `POST` is mid-flight returns the turns recorded **so far** at the moment of the read. The `tryActivate`/`markIdle` machinery already serializes writes; reads do not race with writes because `turnHashes` is mutated synchronously per turn `store.put`. The `total` value of the response is therefore the count of turns visible to the read.
- **Tests** under `packages/server/tests/messages-history.test.ts`:
  - Empty session (no sends): `200`, `value.total: 0`, `value.turns: []`.
  - 1-send session (1 user + N assistants): `value.turns.length === 1 + N`, indices `0..N`.
  - Pagination 0/2/3, mid-range 1/3, end-of-range 4/10 (limit > remaining).
  - Invalid `limit` and `offset`: -1, "abc", " " (whitespace), float (`1.5`) all 400.
  - Cap: `limit=99999` returns at most 1000.
  - Closed session: still 200 with the recorded turns.
  - Unknown gateway / id: 404 with the right code.
  - `PUT /messages` → 405 with `Allow: GET, POST`.
  - Each returned turn has a `hash` matching `^[0-9A-HJKMNP-TV-Z]{13}$`; `GET /ocas/<hash>` returns the same turn body wrapped in a `@sumeru/turn` envelope.
- All Phase-1/2/3 tests continue to pass.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
