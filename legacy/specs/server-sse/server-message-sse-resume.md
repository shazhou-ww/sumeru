---
scenario: "POST /gateways/:name/sessions/:id/messages supports Last-Event-ID resume by replaying buffered events from CAS / in-memory ring on reconnect"
feature: server-http
tags: [http, session, message, sse, resume, last-event-id, ring-buffer, phase-3]
---

## Given
- The SSE message endpoint from `server-message-sse-endpoint.md` is implemented.
- The server maintains an **in-memory event log per active send** — a sequence of `(id, event, data)` triples — that lives until the client disconnects cleanly OR `send` resolves and the connection closes naturally.
- A retention policy: events are buffered for at least `30s` after `event: done` is emitted, so a slightly-late reconnect can still resume. After the retention window, the buffer is dropped and a Last-Event-ID resume returns `410 Gone`.
- The architecture spec (lines 261–267) explicitly requires this behavior: *"每个事件带 id（递增序号）。客户端断连后重连时发送 Last-Event-ID 头，Sumeru 从断点继续推送。Turn 数据在 ocas 里，重推零成本"*.
- For Phase-3 MVP, **events are buffered in-memory only** (a ring buffer keyed by `(gatewayName, sessionId, sendNonce)`). Forward-compat: a later phase can persist them in CAS so resume works across server restarts; the wire format is identical.
- **Phase A3 (PR #114) added CAS-backed frame persistence.** The in-memory ring buffer remains as hot cache for fast replay of recent events, but CAS provides durable replay with no length or time limit. The 30s/1024 constraints apply only to the hot-path buffer, not to overall resume capability.

## When
- The client begins a `POST .../messages` request and starts receiving the SSE stream.
- Mid-stream (between `id: 2` and `id: 3`), the client's TCP connection is broken (simulated in tests by a `socket.destroy()` on the client side).
- The client sleeps 1 s and reconnects with the same request:
  ```
  POST /gateways/hermes/sessions/ses_<X>/messages HTTP/1.1
  Content-Type: application/json
  Accept: text/event-stream
  Last-Event-ID: 2

  {"content": "Say hi in one word."}
  ```
- A second test variant: the client reconnects ONLY for resume (`POST .../messages` with `Last-Event-ID` and an **empty body**) — see "Resume-only request" below.

## Then
- **Resume with original body** —
  - HTTP `200 OK` with the same SSE headers as the original.
  - The server detects `Last-Event-ID: 2` and looks up the buffered event log for the (still-running or recently-completed) `send` call on `(gatewayName, sessionId)`.
  - The server replays events with `id > 2` in order (no duplicates, no gaps). If the original stream emitted `id: 1, 2, 3, 4` (done), the resumed stream emits **only** `3` and `4`.
  - The session status is NOT re-flipped — the original `send` is still the canonical one. (If the original `send` is still in flight, the buffer is "live" and replays then continues; if it already finished, the buffer is "static" and replays then closes.)
  - The original (broken) connection's events do NOT count for `409 session_busy` — the second connection is treated as a continuation, not a new send.
- **Resume-only request — empty body with Last-Event-ID** — When the client sends a request with `Last-Event-ID` and an empty/missing body, the server treats it as a pure resume:
  - It does NOT call `adapter.send` again.
  - It only replays from the buffer and closes.
  - Any `409 session_busy` rule does NOT apply (no new send is starting).
  - If no buffer exists for the (gateway, session) pair, the response is `404 not_found` with `value.error: "no_event_buffer"` and `value.message: "No buffered SSE stream to resume on session ses_<X>"`.
- **Resume after `done`** — If the original stream emitted `event: done` (id `4`) and the buffer is still warm (within 30 s), a Last-Event-ID resume:
  - With `Last-Event-ID: 3` → emits `id: 4` (the done) and closes.
  - With `Last-Event-ID: 4` → emits **no events** and closes immediately (200 OK, empty body — the client is already up-to-date).
  - With `Last-Event-ID: 99` (beyond the highest id) → `400 invalid_request` with `value.error: "invalid_last_event_id"` and `value.message: "Last-Event-ID 99 is greater than the highest known event id 4"`.
- **Resume after buffer expiry** — A Last-Event-ID resume more than 30 s after `event: done` returns `410 Gone` with `value.error: "stream_expired"` and `value.message: "SSE stream for session ses_<X> has expired (retained 30s after completion)"`. The session itself is unaffected — the client may issue a fresh `POST .../messages` (a new send).
- **Last-Event-ID format** — The header value MUST parse as a non-negative integer. Anything else (`abc`, `-1`, empty string with the header present) returns `400 invalid_request` with `value.error: "invalid_last_event_id"`.
- **Header case-insensitivity** — `Last-Event-ID`, `last-event-id`, and `LAST-EVENT-ID` all work (HTTP header names are case-insensitive).
- **No event id reuse across sends** — Each `send` call has its own ring buffer keyed by an internal `sendNonce`; the `id` counter resets to `1` for each new send. Two sends on the same session do not share a buffer; the server resolves the right buffer using a "most recent send on this session" rule when the request body is empty (`Last-Event-ID` resume), or using the just-started send when the body is non-empty.
- **Buffer size** — The ring buffer holds the most recent `1024` events per send (configurable via `ServerConfig.sseBufferSize`). For typical flows (≤ 50 turns + heartbeats), this never wraps. If a slow client requests `Last-Event-ID: <n>` where `<n>` is older than the oldest buffered event, response is `410 Gone` with `value.error: "events_evicted"` and `value.message` naming the lowest still-buffered id.
- **No native session double-spawn** — A unit test asserts `adapter.send` is called **at most once** per logical send across original + resumed connections (so a flaky client that reconnects 5 times doesn't spawn 5 hermes processes).
- **Memory cleanup** — After 30 s past `event: done` (or the connection closing without resume), the buffer is freed. Verified by a unit test that asserts `process.memoryUsage().heapUsed` returns to baseline after 60 s for a stream that emitted `done`.
- **Tests** under `packages/server/tests/messages-sse-resume.test.ts`:
  - Resume mid-stream with original body → continuation works; total events received across both connections covers `id 1..N` exactly once.
  - Resume with empty body → no new send, just replay.
  - Resume after done within 30 s → replays remaining events.
  - Resume after done past 30 s → 410.
  - Resume with `Last-Event-ID` beyond max → 400.
  - Resume with malformed `Last-Event-ID` → 400.
  - Resume with no buffer → 404 `no_event_buffer`.
  - Resume request triggers at most one `adapter.send` invocation across reconnects.
  - Buffer eviction (force `sseBufferSize=4`, emit 10 events, resume from id `1`) → 410 `events_evicted`.
- All Phase-1, Phase-2, and Phase-3 message-endpoint tests continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
