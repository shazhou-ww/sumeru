---
scenario: "POST /gateways/:name/sessions/:id/messages forwards `content` to the adapter via send(), streams turn / heartbeat / done events as SSE, and concludes with a summary"
feature: server-http
tags: [http, session, message, sse, turn, heartbeat, done, envelope, phase-3]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running with the `hermes` adapter registered (see `server-adapter-integration.md`).
- The client has an idle session: `ses_<X>` on gateway `hermes` (created via `POST .../sessions`).
- For deterministic tests, the spec exercises the endpoint with a **stubbed adapter** whose `send` resolves with a known `AgentResponse`. An opt-in integration test (`SUMERU_HERMES_INTEGRATION=1`) runs against a real `hermes`.
- All ocas envelope schemas referenced in the SSE stream — `@sumeru/turn`, `@sumeru/heartbeat`, `@sumeru/summary`, `@sumeru/error` — are documented in `specs/architecture.md` and stable.

## When
- The client issues:
  ```
  POST /gateways/hermes/sessions/ses_<X>/messages HTTP/1.1
  Host: 127.0.0.1:<port>
  Content-Type: application/json
  Accept: text/event-stream

  {"content": "Say hi in one word."}
  ```
- The stubbed adapter's `send` is configured to produce two assistant turns (one with a tool call, one without), with realistic token counts and a `durationMs` of 1500.

## Then
- **HTTP status & headers** —
  - HTTP `200 OK` (NOT `201` — POST + body but it's a streaming RPC, not a resource creation).
  - `Content-Type: text/event-stream; charset=utf-8`.
  - `Cache-Control: no-cache, no-transform`.
  - `Connection: keep-alive`.
  - `X-Accel-Buffering: no` (defeats nginx proxy buffering — important for proxies like the architecture spec mentions).
  - **No `Content-Length`** header (streaming body).
- **Status flip — `idle → active → idle`** — The server calls `sessions.tryActivate(gateway, id)` BEFORE invoking the adapter. While `send` runs, the session's status is `active`; after `send` resolves (success OR failure), the server calls `sessions.markIdle(gateway, id)`. A concurrent `POST .../messages` against the same session while the first is in flight returns `409 session_busy` (per `server-session-status-state-machine.md`).
- **SSE stream — turn events** — Each turn from the adapter's `AgentResponse.turns` is emitted as a separate SSE record:
  ```
  id: <n>
  event: turn
  data: {"type":"@sumeru/turn","value":<Turn>}

  ```
  - `<n>` starts at `1` and increments by `1` per event (regardless of event type).
  - `data` is on a single line (no embedded newlines — JSON is encoded compactly without `\n`).
  - `value` is the full `Turn` object (all keys present, including `toolCalls` which may be `null`).
  - Two consecutive turns produce events with `id: 1` and `id: 2` respectively.
- **SSE stream — done event** — After the last turn, the server emits exactly one:
  ```
  id: <n+1>
  event: done
  data: {"type":"@sumeru/summary","value":{"turnCount":2,"tokens":{"in":N,"out":M},"durationMs":1500}}

  ```
  - `value.turnCount` is the count of `event: turn` records emitted in this stream.
  - `value.tokens` is the aggregate of `AgentResponse.tokens`; `null` when the adapter could not report tokens.
  - `value.durationMs` is `AgentResponse.durationMs` (adapter-reported).
  - The connection is then **closed** by the server (TCP FIN). The client sees stream end.
- **SSE stream — heartbeat events (preventive)** — If the adapter takes more than the configured heartbeat interval (default `15000` ms; configurable via `ServerConfig.sseHeartbeatMs`) between turns, the server emits:
  ```
  id: <n>
  event: heartbeat
  data: {"type":"@sumeru/heartbeat","value":{"elapsed":<ms>}}

  ```
  - `value.elapsed` is monotonic milliseconds since the start of this `send` call.
  - Heartbeats consume `id` numbers (so client can resume from any heartbeat — see `server-message-sse-resume.md`).
  - Heartbeats are NOT emitted if the next turn arrives before the interval elapses.
  - For the unit test, the stubbed adapter delays `send` resolution by `2 × heartbeatMs`; the test asserts at least one heartbeat appears in the stream.
- **SSE event terminator** — Each event is terminated by `\n\n` (two LFs). No CRLF. (matches the SSE wire format used by browsers' EventSource.)
- **Adapter failure** — If `adapter.send` rejects:
  - The server emits exactly one error event:
    ```
    id: <n>
    event: error
    data: {"type":"@sumeru/error","value":{"error":"adapter_error","message":"<adapter error, truncated to 500 chars>"}}

    ```
  - Followed by closing the connection. The session status is flipped back to `idle` (NOT `closed` — adapter errors are recoverable).
  - No `event: done` is emitted.
  - HTTP status is still `200 OK` (it was sent before the error was discoverable). The error is signaled inside the SSE stream, per the architecture spec.
- **Empty content** — A request with `{"content": ""}` is rejected at the HTTP layer (BEFORE flipping status) with `400 invalid_request` and `value.message: "Field 'content' must be a non-empty string"`. No SSE stream is opened.
- **Missing content** — A request body without `content` returns `400 invalid_request` with `value.message: "Missing required field 'content'"`. No SSE stream is opened.
- **Closed session** — `POST .../messages` against a `closed` session returns `404 session_not_found` (NOT 410) — closed sessions are not addressable for new sends. (Note: `GET .../messages` for history is specified separately and does still work on closed sessions, mirroring `GET .../sessions/:id` Phase-2 behavior.)
- **Unknown gateway / unknown id** — Same 404 codes as Phase-2 detail endpoint (`gateway_not_found`, `session_not_found`).
- **Method enforcement** — `GET /gateways/:name/sessions/:id/messages` is the **history** endpoint (specced separately in a follow-up spec; not in scope here). `PUT/PATCH/DELETE .../messages` returns `405` with `Allow: GET, POST`.
- **`Accept` negotiation** — When the client sends `Accept: application/json`, the server STILL returns SSE in Phase 3 (the endpoint is SSE-only). A future enhancement may return JSON when `Accept: application/json` is preferred; not in scope.
- **Tests** under `packages/server/tests/messages-sse.test.ts`:
  - Stubbed adapter, two turns, no tool calls → 2 `event: turn` + 1 `event: done`, ids `1, 2, 3`.
  - Stubbed adapter, one turn with toolCalls populated → toolCalls survive in the wire JSON.
  - Stubbed adapter rejects → exactly one `event: error`, no `event: done`.
  - Stubbed adapter delays > 2× heartbeat interval → heartbeat appears between turns.
  - Concurrent POST → second returns 409 `session_busy`.
  - Empty / missing content → 400.
  - Closed session → 404.
  - Unknown gateway / unknown id → 404 with the right code.
  - `PUT .../messages` → 405 with `Allow: GET, POST`.
  - One opt-in integration test against real `hermes` (gated on `SUMERU_HERMES_INTEGRATION=1`) verifies a real assistant turn appears in the stream.
- All Phase-1 and Phase-2 tests continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
