---
scenario: "When an adapter yields a `suspend` SendEvent (send timed out), the server emits exactly one `event: suspend` SSE frame carrying nativeId + elapsedMs, then closes the stream — never an `event: error` for a timeout"
feature: server-http
tags: [http, sse, suspend, timeout, phase-1]
---

## Given
- A `sumeru start --port 0 --config <fixture>.yaml` process is running with at least one gateway registered.
- The client holds an idle session `ses_<X>` and has already received an HTTP `200` with `Content-Type: text/event-stream` for `POST /gateways/<gw>/sessions/ses_<X>/messages`.
- The session status has been flipped `idle → active` and the server is consuming `adapter.send(...)` via the `for await (const event of ...)` loop in `packages/server/src/sse/messages.ts` (the loop at ~line 360, with `done` handled at 443 and `error` at 458).
- The SSE writer uses `appendEvent(buf, <eventName>, <data>)` + `res.write(formatEvent(evt))`; the event name is a free string (no enum/whitelist to extend), and the stream is closed by the shared `finally` block (lines 488-489: `clearInterval(heartbeatTimer)` + `sessions.markIdle(...)`) followed by `bufferStore.finish(buf)` + `res.end()` (492-493).
- `@sumeru/core` `SendEvent` now includes `{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }` (see `specs/architecture/adapter-send-suspend-event.md`).
- The gateway's adapter is stubbed/configured so that `send` yields a terminal `suspend` event (e.g. a fake adapter that yields zero or more `turn` events then `{ type: "suspend", reason: "timeout", nativeId: "<id>", elapsedMs: <n> }` and returns — simulating the real adapters' `timedOut` branch).

## When
- The adapter's `send` iterable yields a `{ type: "suspend", … }` event and then completes (the generator `return`s — `suspend` is the last event it produces).

## Then
- A new `else if (event.type === "suspend")` branch is added in `messages.ts` **before** the existing `else if (event.type === "error")` at line 458. It emits exactly one SSE record, symmetric to the `@sumeru/error` payload shape:
  ```
  id: <n>
  event: suspend
  data: {"type":"@sumeru/suspend","value":{"reason":"timeout","nativeId":"<id>","elapsedMs":<n>}}

  ```
  built via:
  ```typescript
  } else if (event.type === "suspend") {
    const suspendEvt = appendEvent(
      buf,
      "suspend",
      JSON.stringify({
        type: "@sumeru/suspend",
        value: {
          reason: event.reason,
          nativeId: event.nativeId,
          elapsedMs: event.elapsedMs,
        },
      }),
    );
    res.write(formatEvent(suspendEvt));
  }
  ```
- The frame's `event:` line reads `suspend` (NOT `error`, NOT `done`).
- `data` is a single compact JSON line with no embedded raw newlines: top-level `type` is the literal `"@sumeru/suspend"`; `value` carries exactly `reason` (`"timeout"`), `nativeId` (the non-empty string from the event), and `elapsedMs` (the number from the event). The wire field order mirrors `@sumeru/error` / `@sumeru/summary` conventions (`{ type, value }`).
- `<n>` continues the stream's monotonic event-id sequence (heartbeats and earlier turns consume ids; the id is NOT reset for suspend).
- **`suspend` is the last frame.** After it, NO `event: turn`, `event: done`, or `event: error` is emitted. The branch needs **no** `break` or bespoke teardown: the adapter generator has already `return`ed, so the `for await` loop ends naturally and control falls through to the shared `finally` — reusing the exact same close path as `done` (RFC #95 design principle 1: do NOT write new close logic).
- The server then closes the connection (TCP FIN); the client observes stream end. HTTP status stays `200` (it was sent before streaming began).
- **Status is reset to `idle`** via the shared `finally`'s `sessions.markIdle(gatewayName, sessionId)` — identical to the `done` and non-fatal `error` paths. A suspended send is not fatal; the session may be sent to (resumed) again. The session is NOT marked `closed`.
- A timeout is conveyed **only** as `event: suspend`, never as `event: error`. (Pre-stream failures — empty content, unknown gateway/session — are still handled at the HTTP layer before the stream opens and are unaffected.)

## Notes
- **OCAS:** Phase 1 takes the minimal path — `suspend` is emitted to the SSE stream only and is NOT recorded as an ocas node (no `@sumeru/suspend` schema registered). It carries no turn content, mirroring how `event: error` is not forced to persist a turn. Registering an ocas schema for suspend is explicitly deferred.
- Tests under `packages/server/tests/messages-sse.test.ts` (or a sibling) add:
  - Fake adapter yields `suspend` → stream contains exactly one `event: suspend` frame whose `data` parses to `{ type: "@sumeru/suspend", value: { reason: "timeout", nativeId, elapsedMs } }`; `nativeId` is a non-empty string and `elapsedMs` is a number.
  - Fake adapter yields one `turn` then `suspend` → frames are `event: turn` (id 1) then `event: suspend` (id 2); NO `event: done` and NO `event: error` follow.
  - After the stream ends, session status is `idle` (not `closed`).
- This is the user-visible target of testing issue #98 Step 3: a fake/slow adapter that times out produces a terminal `event: suspend` frame and the connection closes.
