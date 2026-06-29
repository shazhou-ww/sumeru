---
scenario: "POST messages on an active session returns 409 session_busy"
feature: server-http
tags: [http, session, concurrency, 409]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running with the `hermes` gateway registered.
- The client holds session `ses_<X>` on gateway `hermes` whose status is **already `active`** — i.e. an earlier `POST /gateways/hermes/sessions/ses_<X>/messages` is in flight and its `adapter.send(...)` has not yet resolved (per `server-session-status-state-machine.md`).
- That first request has already returned `HTTP 200` with `Content-Type: text/event-stream` and may have already streamed zero or more `event: turn` / `event: heartbeat` records.

## When
- A **second, concurrent** client issues:
  ```
  POST /gateways/hermes/sessions/ses_<X>/messages HTTP/1.1
  Host: 127.0.0.1:<port>
  Content-Type: application/json
  Accept: text/event-stream

  {"content": "this is a racing message"}
  ```

## Then
- The second request is rejected at the HTTP layer with **no SSE stream opened**:
  ```
  HTTP/1.1 409 Conflict
  Content-Type: application/json; charset=utf-8

  {
    "type": "@sumeru/error",
    "value": {
      "error": "session_busy",
      "message": "Session ses_<X> on gateway hermes is currently active"
    }
  }
  ```
  - `value.error` is the stable code `session_busy` (matches the state-machine helper's `reason: "busy"` — see `server-session-status-state-machine.md`).
  - `value.message` interpolates the actual session id and gateway name.
  - The response has no `text/event-stream` header, no `id:`/`event:` lines, no `Connection: keep-alive`.
- **The first request is unaffected** — its in-flight `adapter.send(...)` continues to run; its SSE stream continues to emit `turn` / `heartbeat` / `done` events normally and ends with `event: done` followed by connection close. The session status transitions `active → idle` exactly once, when the first `send` resolves.
- The 409 check happens **after** request-body validation but **before** the status flip would occur — i.e. an empty `content` body against a busy session returns `400 invalid_request`, not `409`. Status ordering: body validation → `tryActivate` (which produces the 409 if `active`) → emit SSE / call `adapter.send`.
- A subsequent (third) request issued **after** the first request finishes (session back to `idle`) succeeds normally with `200` + SSE stream — the busy state is transient, not sticky.
- Tests under `packages/server/tests/messages-sse.test.ts`:
  - Stubbed adapter with `send` that resolves after a controllable delay; fire two `POST .../messages` concurrently → first gets `200` + full SSE stream ending in `event: done`; second gets `409` with `session_busy` envelope.
  - After the first stream ends, a fresh `POST .../messages` succeeds with `200` (transient busy state).
  - `POST .../messages` with `{}` (empty content) against a busy session → `400 invalid_request` (body validation wins over concurrency check).
