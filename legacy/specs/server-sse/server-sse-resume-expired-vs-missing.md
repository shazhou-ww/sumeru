---
scenario: "SSE resume distinguishes expired buffers (410 stream_expired) from never-existed buffers (404 no_event_buffer)"
feature: server-http
tags: [http, session, message, sse, resume, buffer-expiry, fix-58]
---

## Given
- The SSE message endpoint and in-memory buffer store from `server-message-sse-resume.md` are implemented.
- A gateway `hermes` is configured with a mock adapter.
- A session `ses_ABC` exists on `hermes` in `idle` status.
- `ServerConfig.sseRetentionMs` is set to `30_000` (30 seconds).
- The buffer store tracks **recently-expired** session keys for a grace window (at least `retentionMs` after purge) so resume can distinguish "buffer existed but expired" from "buffer never existed".

## When — Scenario A: Resume after buffer expired

1. A `POST /gateways/hermes/sessions/ses_ABC/messages` completes with `event: done` emitted; buffer is marked finished.
2. More than 30 seconds elapse (simulated via fake timers or by injecting `now` into `purgeExpired`).
3. A new request arrives:
   ```
   POST /gateways/hermes/sessions/ses_ABC/messages HTTP/1.1
   Accept: text/event-stream
   Last-Event-ID: 2
   ```
   with an empty body (pure resume).

## Then — Scenario A

- The server returns HTTP `410 Gone`.
- Response body is JSON:
  ```json
  {
    "type": "@sumeru/error",
    "value": {
      "error": "stream_expired",
      "message": "SSE stream for session ses_ABC has expired (retained 30s after completion)"
    }
  }
  ```
- The session itself remains in `idle` status (unaffected).

---

## When — Scenario B: Resume when buffer never existed

1. Session `ses_XYZ` exists on `hermes` in `idle` status.
2. No `POST .../messages` has ever been sent to this session (no buffer was ever created).
3. A request arrives:
   ```
   POST /gateways/hermes/sessions/ses_XYZ/messages HTTP/1.1
   Accept: text/event-stream
   Last-Event-ID: 1
   ```
   with an empty body (pure resume).

## Then — Scenario B

- The server returns HTTP `404 Not Found`.
- Response body is JSON:
  ```json
  {
    "type": "@sumeru/error",
    "value": {
      "error": "no_event_buffer",
      "message": "No buffered SSE stream to resume on session ses_XYZ"
    }
  }
  ```

---

## When — Scenario C: Resume-with-body after buffer expired

1. A `POST /gateways/hermes/sessions/ses_ABC/messages` completed with `event: done`.
2. More than 30 seconds elapse.
3. A new request arrives with BOTH a body and `Last-Event-ID`:
   ```
   POST /gateways/hermes/sessions/ses_ABC/messages HTTP/1.1
   Content-Type: application/json
   Accept: text/event-stream
   Last-Event-ID: 3

   {"content": "Hello again"}
   ```

## Then — Scenario C

- The server returns HTTP `410 Gone`.
- Response body is JSON:
  ```json
  {
    "type": "@sumeru/error",
    "value": {
      "error": "stream_expired",
      "message": "SSE stream for session ses_ABC has expired (retained 30s after completion)"
    }
  }
  ```
- `adapter.send` is NOT invoked (the request is rejected before dispatch).

---

## Implementation Constraint

- `SseBufferStore` must expose a method to check whether a buffer **recently expired** for a given `(gateway, sessionId)` pair:
  - Signature: `wasRecentlyExpired(gateway: string, sessionId: string) => boolean`
  - The set of recently-expired keys is pruned on each `purgeExpired` call; entries older than `retentionMs` past their expiry time are removed (so the ghost set does not grow unbounded).
- `purgeExpired` must populate this set BEFORE deleting from the live store.
- The resume code path (both `handleResumeOnly` and the resume-with-body branch) must check `wasRecentlyExpired` when `getLatestForSession` returns `null`:
  - If `wasRecentlyExpired` → 410 `stream_expired`
  - Else → 404 `no_event_buffer`

## Tests

- Under `packages/server/tests/messages-sse-resume.test.ts` (or a new file `messages-sse-resume-expired.test.ts`):
  - **A**: resume empty-body after 30s → 410 `stream_expired`.
  - **B**: resume empty-body with no prior send → 404 `no_event_buffer`.
  - **C**: resume-with-body after 30s → 410 `stream_expired`.
  - **D**: resume within 30s still works → 200 with replayed events (regression guard).
  - **E**: the recently-expired ghost set is bounded — after `2 * retentionMs` the ghost entry is also purged, and a resume returns 404 (not 410 indefinitely).
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
