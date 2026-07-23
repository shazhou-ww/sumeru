---
title: "TC: Expired Last-Event-ID — 410 Gone"
spec: ./spec.md
scenarios: [3]
status: not-verifiable
---

# TC: Expired Last-Event-ID — 410 Gone

## Objective

Verify that when `Last-Event-ID` references an event that has been evicted from the ring buffer (capacity 1024), the server responds with HTTP 410 Gone.

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- A session that has generated MORE than 1024 events (so the buffer has wrapped)
- The ring buffer default capacity is 1024 events

## Steps

1. Create a session that generates 1024+ events. This requires a task that triggers many tool calls and turns:
   ```bash
   # This would require a very long-running task with many turns
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"test","task":"<task that generates 1024+ events>"}'
   ```

2. Wait for enough events to overflow the buffer (oldest events evicted).

3. Attempt to reconnect with an evicted event ID:
   ```bash
   curl -s -H 'Accept: text/event-stream' \
     -H 'Last-Event-ID: 1' \
     http://127.0.0.1:7901/sessions/:id/events
   ```

## Assertions

- **A1**: HTTP response status is `410 Gone`
- **A2**: Response body contains JSON error:
  ```json
  {
    "error": {
      "code": "sse_buffer_expired",
      "message": "Last-Event-ID is no longer in the replay buffer"
    }
  }
  ```
- **A3**: The connection is NOT upgraded to SSE (no event stream)
- **A4**: Client should interpret this as needing to create a new session or fetch full history via another mechanism

## Notes

This test case is **not practically verifiable** in a standard test run because:
- Generating 1024+ distinct events requires a very long-running session with extensive tool use
- Each turn only produces 1 event in the buffer
- A single task would need 1024+ turns which is impractical in testing

### Workaround Verification

The ring buffer behavior is verified through the source code at:
- `packages/host/src/sse-buffer.ts` — `isExpired()` checks `lastEventId < oldestId()`
- When expired, handler returns 410 before opening SSE stream

## Verification Result

**NOT VERIFIABLE** — Cannot trigger 1024+ events in a practical test scenario.

The happy-path behavior (resume with valid Last-Event-ID) is confirmed working, which validates the underlying buffer implementation. The 410 path is a boundary condition of the same `eventsAfter()` / `isExpired()` logic.
