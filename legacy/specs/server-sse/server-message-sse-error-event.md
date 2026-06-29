---
scenario: "SSE error event format for adapter failures"
feature: server-http
tags: [http, sse, error]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running with the `hermes` gateway registered.
- The client holds an idle session `ses_<X>` on gateway `hermes` and has already received an HTTP `200` response with `Content-Type: text/event-stream` for `POST /gateways/hermes/sessions/ses_<X>/messages`.
- The session's status has already been flipped from `idle` → `active` (per `server-session-status-state-machine.md`) and the server is currently awaiting `adapter.send(...)`.
- The adapter's `send` is stubbed to **reject** (simulating an underlying agent communication failure, e.g. `adapter_error`), with a deterministic error object carrying `.message`.

## When
- The stubbed `adapter.send(...)` rejects (or the streaming generator throws after one or more `turn` events have been emitted).

## Then
- The server emits **exactly one** SSE error event as the next record in the stream:
  ```
  id: <n>
  event: error
  data: {"type":"@sumeru/error","value":{"error":"adapter_error","message":"<truncated message>"}}

  ```
  - `<n>` continues the monotonic event-id sequence used by the stream (heartbeats and earlier turns consume ids; this is NOT reset on error).
  - `data` is a single line — JSON encoded compactly with no embedded `\n`.
  - `value.error` is the stable code `adapter_error`. (Future adapter-specific error codes are reserved but out of scope here.)
  - `value.message` is the adapter error's `.message`, truncated to **500 characters** if longer, and never contains raw newlines (they are escaped).
- The error event is followed by the server closing the connection (TCP FIN). The client observes stream end.
- **No `event: done` is emitted** after the error event. The summary is skipped because the turn did not complete.
- **Status is reset to `idle`** — after the error path resolves, the server calls `sessions.markIdle("hermes", "ses_<X>")`. Adapter errors are recoverable; the session is **not** marked `closed` and may be sent to again (see `server-session-status-state-machine.md`: `active → idle` on send-finish, success OR non-fatal error).
- **HTTP status stays `200`** — the `200` was already sent before `send` rejected (streaming response), so the failure is conveyed entirely inside the SSE stream rather than via a new HTTP status code.
- **Empty/missing-content rejections** and **unknown gateway/session** errors are handled at the HTTP layer BEFORE the stream opens (see `server-message-sse-endpoint.md`) and are NOT conveyed as `event: error`; this spec only covers errors that surface AFTER the SSE response has begun.

## Notes
- Implementation hint: the error event should be emitted from a single shared `emitSseError(res, code, message)` helper that also schedules `res.end()` and `markIdle`, so success/failure paths cannot drift apart.
- Tests under `packages/server/tests/messages-sse.test.ts`:
  - Stubbed adapter rejects immediately → exactly one `event: error`, no `event: done`, session status `idle` afterward.
  - Stubbed adapter emits one turn then rejects → `event: turn` (id 1), `event: error` (id 2), no `event: done`.
  - Adapter error with `.message` longer than 500 chars → `value.message.length === 500`.
  - Adapter error with newlines in `.message` → no raw `\n` in the `data:` line (escaped as `\\n`).
