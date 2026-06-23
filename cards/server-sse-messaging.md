---
id: server-sse-messaging
title: "SSE Messaging and Resume Semantics"
sources:
  - packages/server/src/sse/messages.ts
  - packages/server/src/sse/buffer.ts
  - packages/server/tests/messages-sse-resume-expired.test.ts
tags: [architecture, server, sse, messaging, streaming]
created: 2026-06-15
updated: 2026-06-23
---

# SSE Messaging and Resume Semantics

`POST /gateways/:name/sessions/:id/messages` streams SSE events from adapter sends and supports replay/resume via `Last-Event-ID` backed by an in-memory per-send buffer.

## Event Model

The endpoint emits SSE events with numeric `id`:

- `turn` -> `@sumeru/turn`
- `heartbeat` -> `@sumeru/heartbeat`
- `done` -> `@sumeru/summary`
- `error` -> `@sumeru/error`

`formatEvent` serializes wire format as `id/event/data` lines.

## Buffer Model

`createSseBufferStore({ maxSize, retentionMs })` stores buffers per `(gateway, sessionId, nonce)`:

- ring retention of latest `maxSize` events
- `latestBySession` points to most recent send buffer for resume lookup
- `finish(buf)` marks completion with `doneAt`
- `purgeExpired(now)` removes completed buffers older than `retentionMs`

### Recently-Expired Ghost Tracking

When a completed buffer expires, the store records the session key in a `recentlyExpired` map. This enables returning `410 stream_expired` instead of `404` immediately after expiry.

Ghost entries are pruned after another retention window, so very old resumes fall back to `404 no_event_buffer`.

## Last-Event-ID Validation

`Last-Event-ID` must be a non-empty non-negative integer string; invalid values return `400 invalid_last_event_id`.

For existing buffers:

- `since > maxId` -> `400 invalid_last_event_id`
- `since < lowestBufferedId - 1` -> `410 events_evicted`

## Resume Modes

The endpoint distinguishes two resume paths when `Last-Event-ID` is present:

1. Resume-only (empty body): replay buffered events and end.
2. Resume-with-body (`content` present): attach to current live buffer and stream replay + new events.

If no live/latest buffer exists:

- recently expired session -> `410 stream_expired`
- otherwise -> `404 no_event_buffer`

This `410` behavior applies to both resume-only and resume-with-body paths.

## Expiry Semantics (Fix)

`messages-sse-resume-expired.test.ts` verifies:

- prior send + resume after retention -> `410 stream_expired`
- no prior send -> `404 no_event_buffer`
- resume-with-body after retention -> `410 stream_expired`
- resume within retention -> `200` SSE replay works
- after ghost pruning (about `2 * retentionMs` elapsed) -> `404 no_event_buffer`

## Send Path Notes

For non-resume sends:

- user turn is recorded to OCAS and indexed before stream start
- per-turn assistant results are recorded/indexed before `turn` emission
- adapter-level or persistence/index failures emit SSE `error` events (or pre-stream JSON 500 when failure occurs before headers)
- session is marked idle in `finally` after send loop cleanup

## Headers and Heartbeats

SSE responses set:

- `Content-Type: text/event-stream; charset=utf-8`
- `Cache-Control: no-cache, no-transform`
- `Connection: keep-alive`
- `X-Accel-Buffering: no`

`startHeartbeats` emits `heartbeat` on `Math.max(50, sseHeartbeatMs)` interval and uses `timer.unref()`.
