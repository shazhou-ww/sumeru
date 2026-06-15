---
id: server-sse-messaging
title: "SSE Messaging"
sources:
  - packages/server/src/sse/messages.ts
  - packages/server/src/sse/buffer.ts
  - packages/server/src/sse/index.ts
tags: [architecture, server, sse, messaging, streaming]
created: 2026-06-15
updated: 2026-06-15
---

# SSE Messaging

The `packages/server/src/sse/` module implements the `POST /gateways/:name/sessions/:id/messages` endpoint — the primary interaction path where clients send content to an agent and receive streamed responses via Server-Sent Events.

## SSE Event Types

| Event | Envelope Type | Description |
|-------|---------------|-------------|
| `turn` | `@sumeru/turn` | An assistant turn (content + toolCalls + hash) |
| `heartbeat` | `@sumeru/heartbeat` | Keep-alive with elapsed time |
| `done` | `@sumeru/summary` | Final summary (turnCount, tokens, durationMs) |
| `error` | `@sumeru/error` | Adapter or validation failure |

Each event carries an auto-incrementing `id:` field for resume support.

## Request Flow

```
POST .../messages
  { "content": "user message" }
  [Last-Event-ID: N]  (optional)
```

### Normal Send

1. Validate session exists and is not closed
2. Parse `Last-Event-ID` header (if present)
3. Parse JSON body, extract `content` field
4. Transition session idle → active (`tryActivate`, 409 if busy)
5. Retrieve `NativeSessionRef` from store
6. Record user turn to ocas + search index (failure → restore idle, return 500 JSON)
7. Create SSE buffer, write SSE headers, start heartbeat timer
8. Call `adapter.send(nativeRef, content)` — await full response
9. **`finally` block**: stop heartbeat timer, mark session idle (idle before turn emission)
10. For each response turn: record to ocas → index → append hash → emit `turn` event
11. Emit `done` event with summary
12. Finish buffer, end response

### Resume Modes

Two resume strategies using `Last-Event-ID`:

| Mode | Trigger | Behavior |
|------|---------|----------|
| **Resume-only** | `Last-Event-ID` + empty body | Pure replay from buffer — no adapter call |
| **Resume-with-body** | `Last-Event-ID` + content | Continue streaming from existing live buffer |

Resume is a **pure replay** — `adapter.send` is never called twice.

## Ring Buffer

Each send creates a fresh `SseBuffer` that retains the most recent N events (configurable via `sseBufferSize`, default 1024):

```typescript
type SseBuffer = {
  gateway: string;
  sessionId: string;
  nonce: string;          // unique per-send identifier
  events: SseEvent[];     // ring buffer (oldest shift off when > maxSize)
  maxId: number;          // highest event ID emitted
  doneAt: number | null;  // timestamp when send completed
  maxSize: number;        // ring capacity
  finished: boolean;      // true after done/error
};

type SseEvent = {
  id: number;             // monotonic, 1-based
  event: string;          // "turn" | "heartbeat" | "done" | "error"
  data: string;           // pre-serialized JSON envelope
};
```

### Buffer Store

`SseBufferStore` manages buffer lifecycle:

| Method | Description |
|--------|-------------|
| `create(gateway, sessionId)` | Allocate a new buffer with a fresh nonce |
| `getLatestForSession(gateway, sessionId)` | Find the most recent buffer for resume |
| `finish(buf)` | Mark done, stamp `doneAt` timestamp |
| `purgeExpired(now)` | Remove buffers past `retentionMs` after completion |

Buffers are keyed by `gateway\0sessionId\0nonce`. A `latestBySession` index maps `gateway\0sessionId` → latest buffer key for fast resume lookups.

### Retention

After `event: done`, the buffer is retained for `sseRetentionMs` (default 30,000ms). Purging happens at the start of each new message request. This window allows disconnected clients to catch up without re-invoking the adapter.

## Resume Error Cases

| Condition | Status | Error Code |
|-----------|--------|------------|
| No buffer for session | 404 | `no_event_buffer` |
| `Last-Event-ID` > max buffered ID | 400 | `invalid_last_event_id` |
| `Last-Event-ID` < lowest buffered ID (ring evicted) | 410 | `events_evicted` |

## Heartbeat

A periodic `heartbeat` event emits elapsed time since the send started. Configured by `sseHeartbeatMs` (default 15,000ms, minimum clamped to 50ms). The timer is `unref()`'d so it doesn't keep the process alive.

## SSE Wire Format

```
id: 1
event: turn
data: {"type":"@sumeru/turn","value":{...}}

id: 2
event: heartbeat
data: {"type":"@sumeru/heartbeat","value":{"elapsed":15000}}

id: 3
event: done
data: {"type":"@sumeru/summary","value":{"turnCount":1,"tokens":{"in":100,"out":50},"durationMs":2300}}
```

Headers:
```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

## Ocas Integration

Each turn (user and assistant) is written to CAS before its SSE event is emitted:
- The `@sumeru/turn` payload strips `hash` (would be circular) and null `tokens`
- The computed hash is injected into the SSE `turn` event's `value.hash` field
- The hash is appended to `Session.turnHashes` for the history endpoint
- Search index is updated synchronously for both user and assistant turns:
  - **User turn** index failure: happens before SSE stream starts → returns 500 JSON, restores idle
  - **Assistant turn** index failure: happens after SSE stream started → emits SSE `error` event, ends stream

## Concurrency Control

- Only one active send per session (`tryActivate` → 409 `session_busy` if already active)
- Session is marked idle in the `finally` block immediately after `adapter.send` returns (or throws) — **before** turn processing and SSE emission. This means the session is technically idle during the turn-emission phase, but the buffer still holds the stream open for the client.
- If the user turn ocas/index write fails (before SSE starts), the session is restored to idle before returning 500 JSON

## Error Recovery

| Failure Point | Phase | Behavior |
|---------------|-------|----------|
| User turn ocas write | Pre-SSE | Restore idle, return 500 JSON |
| User turn search index write | Pre-SSE | Restore idle, return 500 JSON |
| `adapter.send` throws | Post-SSE | Emit SSE `error` event, finish buffer, end stream |
| Assistant turn ocas write | Post-SSE | Emit SSE `error` event, finish buffer, end stream |
| Assistant turn search index write | Post-SSE | Emit SSE `error` event, finish buffer, end stream |
