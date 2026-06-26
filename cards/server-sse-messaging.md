---
id: server-sse-messaging
title: "SSE Messaging and Resume Semantics"
sources:
  - packages/server/src/sse/messages.ts
  - packages/server/src/sse/action.ts
  - packages/server/src/sse/middleware.ts
  - packages/server/src/sse/encode.ts
  - packages/server/src/sse/buffer.ts
  - packages/server/src/sse/frame-store.ts
  - packages/server/tests/messages-sse-resume-expired.test.ts
  - packages/server/tests/sse-cas-resumable.test.ts
tags: [architecture, server, sse, messaging, streaming]
created: 2026-06-15
updated: 2026-06-26
---

# SSE Messaging and Resume Semantics

`POST /gateways/:name/sessions/:id/messages` streams SSE events from adapter sends and supports replay/resume via `Last-Event-ID`. Events are persisted durably to CAS; the in-memory ring buffer remains as a hot cache for fast replay of recent sends.

## Pipeline Architecture

The SSE send path is a composable generator + middleware pipeline:

```
messageAction (async generator)
  → withResumable (CAS persist)
  → withHeartbeats (heartbeat merge)
  → writeSseStream (encoder + in-memory buffer)
```

1. **`messageAction`** — async generator that drives `adapter.send`, yields `turn` / `done` / `suspend` / `error` events, and records turns to OCAS before emission.
2. **`withResumable`** — middleware that persists each content event to CAS as it passes through. Heartbeats are excluded (ephemeral keepalive). Failures are non-fatal — CAS is a persistence layer underneath the live stream, not a gate.
3. **`withHeartbeats`** — merges periodic `heartbeat` events into the stream while waiting for the next source event (`Math.max(50, sseHeartbeatMs)` interval, `timer.unref()`).
4. **`writeSseStream`** — consumes the final iterable, assigns sequential SSE `id` values via the in-memory buffer, and writes wire-formatted `id/event/data` frames to the HTTP response.

## CAS Frame Persistence

`frame-store.ts` provides durable SSE frame indexing:

- Each content event is recorded as an `@sumeru/sse-frame` payload in the OCAS store.
- A SQLite index table (`sumeru_sse_frames` in `_store.db`) maps `(sessionId, nonce, seq)` → `frameHash`.
- Frames survive server restart with no length or time limit.
- Resume can replay the full event chain from CAS via `replayFromCas` when the in-memory buffer is expired or gone.

## In-Memory Buffer (Hot Cache)

`createSseBufferStore({ maxSize, retentionMs })` still maintains per-send ring buffers keyed by `(gateway, sessionId, nonce)`:

- ring retention of latest `maxSize` events (default 1024)
- `latestBySession` points to most recent send buffer for fast resume lookup
- `finish(buf)` marks completion with `doneAt`
- `purgeExpired(now)` removes completed buffers older than `retentionMs` (default 30s)

When a live or recently-completed buffer exists, resume replays from memory (fast path). When the buffer is gone but CAS frames remain, resume falls back to CAS replay (durable path).

### Recently-Expired Ghost Tracking

When a completed buffer expires, the store records the session key in a `recentlyExpired` map. This enables returning `410 stream_expired` instead of `404` immediately after expiry — but only when no CAS frames exist for replay. If CAS frames are present, `replayFromCas` succeeds regardless of buffer expiry.

Ghost entries are pruned after another retention window.

## Event Model

The endpoint emits SSE events with numeric `id`:

- `turn` → `@sumeru/turn`
- `heartbeat` → `@sumeru/heartbeat`
- `done` → `@sumeru/summary`
- `suspend` → `@sumeru/suspend` (terminal: send interrupted, e.g. `reason: "timeout"`)
- `error` → `@sumeru/error`

`formatEvent` serializes wire format as `id/event/data` lines.

## Last-Event-ID Validation

`Last-Event-ID` must be a non-empty non-negative integer string; invalid values return `400 invalid_last_event_id`.

For in-memory buffer replay:

- `since > maxId` → `400 invalid_last_event_id`
- `since < lowestBufferedId - 1` → `410 events_evicted` (only when CAS replay is also unavailable)

## Resume Modes

The endpoint distinguishes two resume paths when `Last-Event-ID` is present:

1. **Resume-only** (empty body): replay buffered events (memory or CAS) and end.
2. **Resume-with-body** (`content` present): attach to current live buffer and stream replay + new events.

Resolution order when no live buffer exists:

1. recently expired session (ghost) → `410 stream_expired` (if no CAS frames)
2. CAS frames via `replayFromCas` → `200` SSE replay from durable store
3. otherwise → `404 no_event_buffer`

## Send Path Notes

For non-resume sends:

- user turn is recorded to OCAS and indexed before stream start
- per-turn assistant results are recorded/indexed before `turn` emission
- adapter-level or persistence/index failures emit SSE `error` events (or pre-stream JSON 500 when failure occurs before headers)
- session is marked idle in `finally` after send loop cleanup

## Headers

SSE responses set:

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`
