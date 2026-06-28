---
scenario: "GET /gateways/:name/sessions returns a `@sumeru/session-list` envelope of every session on the gateway, including closed ones"
feature: server-http
tags: [http, session, list, envelope, ocas, phase-2]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares two gateways: `hermes` and `claude-code`.
- The client has created sessions in this order, all on gateway `hermes`:
  1. session A — `{}` config
  2. session B — `{ "model": "sonnet-4.5" }` config
  3. session C — `{}` config, then immediately `DELETE`d (so it sits in `closed`)
- The client has also created session D on gateway `claude-code`.

## When
- The client issues each of the following requests in order:
  1. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions`
  2. `curl -fsS -i http://127.0.0.1:<port>/gateways/claude-code/sessions`
  3. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions/`  # trailing slash
  4. `curl -sS  -i http://127.0.0.1:<port>/gateways/does-not-exist/sessions`
  5. `curl -sS  -i -X DELETE http://127.0.0.1:<port>/gateways/hermes/sessions`  # method not allowed at collection
  6. `curl -fsS -i 'http://127.0.0.1:<port>/gateways/hermes/sessions?status=idle'`  # unknown query param

## Then
- **Request 1 (`hermes` listing)** — HTTP `200 OK`, `Content-Type: application/json...`, body:
  ```json
  {
    "type": "@sumeru/session-list",
    "value": [
      { "id": "ses_<A>", "gateway": "hermes", "status": "idle",   "createdAt": "<iso>" },
      { "id": "ses_<B>", "gateway": "hermes", "status": "idle",   "createdAt": "<iso>" },
      { "id": "ses_<C>", "gateway": "hermes", "status": "closed", "createdAt": "<iso>" }
    ]
  }
  ```
  - Top-level keys are exactly `type` and `value`. `value` is an array (never `null`, never an object).
  - The list **includes closed sessions** (session C). Closed sessions stay queryable per the issue's completion criteria.
  - Order is **chronological by createdAt ascending** — i.e. insertion order, matching `POST` order. (Same gateway, deterministic.)
  - Each entry has exactly four keys: `id`, `gateway`, `status`, `createdAt`. `config` is **omitted** from the list view (use `GET .../sessions/:id` for full detail) — this keeps list responses compact.
  - Every `gateway` field equals `"hermes"` (the gateway name from the URL); session D from `claude-code` does NOT appear here.
- **Request 2 (`claude-code` listing)** — HTTP `200`, body contains exactly one entry: session D with `gateway: "claude-code"`. Sessions A/B/C from `hermes` do NOT appear here. Listings are scoped per gateway.
- **Request 3 (trailing slash)** — HTTP `200`, body identical to Request 1. Trailing slash is normalized.
- **Request 4 (unknown gateway)** — HTTP `404`, `@sumeru/error` envelope with `value.error: "gateway_not_found"`. The 404 happens at the gateway-resolution step and matches the Phase-1 `GET /gateways/:name` 404 code.
- **Request 5 (`DELETE /gateways/:name/sessions`)** — HTTP `405 Method Not Allowed` with `Allow: GET, POST` and a `@sumeru/error` envelope. (DELETE only works on a specific session ID, not on the collection.)
- **Request 6 (unknown query param)** — HTTP `200`, body identical to Request 1. Phase-2 ignores all query parameters (filtering / search lands later, see `architecture.md`'s session search section).
- **Empty case** — When no sessions have been created on a gateway, the response is `{ "type": "@sumeru/session-list", "value": [] }` with HTTP `200`. Empty array, never `null`, never a 404.
- **Counter consistency** — `value.length` for gateway `hermes` (excluding `closed` entries) equals the `activeSessions` field returned by `GET /gateways/hermes`. After session C closes, `hermes.activeSessions` = 2 while `value.length` of the listing = 3 (closed sessions are listed but don't count as "active").
- All Phase-1 behaviors continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. Tests cover: empty list, multi-session list with order, list including a closed session, per-gateway scoping, unknown gateway 404, 405 on `DELETE` at collection, and trailing-slash normalization.
