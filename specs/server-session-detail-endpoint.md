---
scenario: "GET /gateways/:name/sessions/:id returns the full @sumeru/session envelope, or a 404 @sumeru/error when missing"
feature: server-http
tags: [http, session, detail, envelope, ocas, error, 404, phase-2]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running on a known port.
- The fixture declares two gateways: `hermes` and `claude-code`.
- The client has created session A on `hermes` with `config: { "model": "sonnet-4.5", "systemPrompt": "be brief" }`. Its returned id is `ses_<A>`.
- The client has created session B on `claude-code` with `config: {}`. Its returned id is `ses_<B>`.
- The client has created session C on `hermes` and immediately `DELETE`d it (status now `closed`). Its returned id is `ses_<C>`.

## When
- The client issues each of the following requests in order:
  1. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<A>`
  2. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<C>`              # closed session
  3. `curl -sS  -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<B>`              # session belongs to claude-code, not hermes
  4. `curl -sS  -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_DOES_NOT_EXIST`   # truly unknown
  5. `curl -sS  -i http://127.0.0.1:<port>/gateways/hermes/sessions/not-an-id`            # missing `ses_` prefix
  6. `curl -sS  -i http://127.0.0.1:<port>/gateways/does-not-exist/sessions/ses_<A>`      # unknown gateway, valid session
  7. `curl -sS  -i -X PATCH http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<A>`     # method not allowed
  8. `curl -fsS -i http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<A>/`             # trailing slash

## Then
- **Request 1 (live session)** — HTTP `200 OK`, `Content-Type: application/json...`, body:
  ```json
  {
    "type": "@sumeru/session",
    "value": {
      "id": "ses_<A>",
      "gateway": "hermes",
      "status": "idle",
      "createdAt": "<iso>",
      "config": { "model": "sonnet-4.5", "systemPrompt": "be brief" }
    }
  }
  ```
  - Top-level keys are exactly `type` and `value`. `value` has exactly five keys: `id`, `gateway`, `status`, `createdAt`, `config`.
  - The shape is identical to the `POST /gateways/:name/sessions` 201 response — `@sumeru/session` is the same schema.
  - `value.config` is the exact opaque blob the client sent on `POST` — round-tripped without modification (no field rename, no field drop, no normalization).
- **Request 2 (closed session)** — HTTP `200`, body identical in shape to Request 1 with `value.status: "closed"`. **Closed sessions remain queryable** — they are never deleted from the in-memory store; only their status flips. (See "完成标准: 关闭后仍可查询".)
- **Request 3 (cross-gateway lookup)** — HTTP `404 Not Found`, `@sumeru/error` envelope with `value.error: "session_not_found"` and a message like `Session ses_<B> not found on gateway hermes`. Sessions are **scoped to their gateway**: fetching session B's id under `/gateways/hermes/...` does NOT find it. (No global session lookup in Phase 2.)
- **Request 4 (unknown id on valid gateway)** — HTTP `404`, `@sumeru/error` with `value.error: "session_not_found"` and the requested id in `value.message`.
- **Request 5 (id without `ses_` prefix)** — HTTP `404`, `@sumeru/error` with `value.error: "session_not_found"`. The server does not validate id format separately; any string that does not match a stored id is simply "not found". (No 400 for malformed id.)
- **Request 6 (unknown gateway)** — HTTP `404`, `@sumeru/error` with `value.error: "gateway_not_found"` (NOT `session_not_found`) — the gateway check happens **before** the session lookup, so callers see the most-specific error code. Same code as Phase-1's `GET /gateways/:name` 404.
- **Request 7 (`PATCH`)** — HTTP `405 Method Not Allowed` with `Allow: GET, DELETE` response header and a `@sumeru/error` envelope (`error: "method_not_allowed"`).
- **Request 8 (trailing slash)** — HTTP `200`, body identical to Request 1. Trailing slash is normalized.
- **Case sensitivity** — `GET .../sessions/SES_<A-uppercased>` returns `404 session_not_found`. Session IDs are case-sensitive (Crockford Base32 ULIDs are emitted uppercase; we don't lower-case them).
- **No leakage of native IDs** — Nowhere in the response body does a Hermes / Claude-Code native session identifier appear; only `ses_…` is exposed. (Reaffirmed for the detail endpoint; original constraint stated in `server-session-id-ulid.md`.)
- **Stable code surface** — The error codes used here (`session_not_found`, `gateway_not_found`, `method_not_allowed`) are the same ones used by every other Phase-1 / Phase-2 endpoint that talks about the same situations. No new code names introduced.
- All Phase-1 behaviors continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. Tests cover: 200 for live & closed sessions (config round-trips), cross-gateway 404, unknown-id 404, unknown-gateway 404, malformed-id 404, 405 on `PATCH`/`PUT`/`POST`, trailing-slash normalization, and case-sensitivity.
