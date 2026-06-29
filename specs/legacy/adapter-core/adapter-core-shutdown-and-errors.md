---
scenario: "The entrypoint shuts down gracefully on stdin end (EOF) and on SIGTERM, and surfaces protocol/handler failures as a terminal {type:'error', value: ErrorValue} frame without crashing mid-stream"
feature: adapter-core
tags: [adapter-core, entrypoint, shutdown, sigterm, stdin-close, graceful, error, lifecycle, m1-3, issue-124]
---

## Given
- `createAdapterEntry(impl)` is running with the init handshake complete (see
  `adapter-core-init-ready-handshake.md`) and able to process messages (see
  `adapter-core-message-handling.md`).
- The injectable stdin/stdout seam from `adapter-core-init-ready-handshake.md` is used so
  EOF, SIGTERM, and malformed input can be simulated deterministically in a unit test. SIGTERM
  handling is verified via the same seam (e.g. an injected signal hook / abort signal) rather
  than by sending a real OS signal to the test runner.
- `ErrorValue` is `{ code: string; message: string }` (from `@sumeru/core`); the outbound
  error frame is `{ type: "error", value: ErrorValue }`.

## When / Then — graceful shutdown on stdin end (EOF)
- **When** stdin reaches end-of-stream (the readable emits `end`) while the entrypoint is idle
  (not mid-`handle`):
- **Then** the entrypoint stops reading and resolves/terminates cleanly: any
  `createAdapterEntry`-returned completion settles without throwing, the process is left ready
  to exit with code `0`, and **no** `error` frame is emitted for a normal EOF.
- **When** stdin ends while a `handle` generator is still producing:
- **Then** the entrypoint does not abandon the in-flight message abruptly — it allows the
  current generator to run to its `done` (draining already-buffered work), then shuts down;
  it does NOT start reading new messages after EOF. (No `turn` is lost for the in-flight message.)

## When / Then — graceful shutdown on SIGTERM
- **When** a `SIGTERM` is delivered (simulated through the injected seam):
- **Then** the entrypoint initiates graceful shutdown: it stops accepting new messages, stops
  the stdin read loop, flushes any already-written stdout bytes, and allows the process to exit
  cleanly (conventionally code `0` for an orderly SIGTERM teardown). The shutdown is idempotent —
  a second SIGTERM does not throw or double-emit frames.
- A handler registered on `process` for `SIGTERM` is installed by `createAdapterEntry` and is
  the mechanism under test (asserted via the seam, not by signalling the Vitest process).

## When / Then — malformed stdin line
- **When** a stdin line is not valid JSON, or is valid JSON but not a recognized frame
  (missing/unknown `type`, e.g. `{"type":"bogus"}` or `not json at all`):
- **Then** the entrypoint emits a terminal `{ type: "error", value: { code, message } }` frame
  with a stable, machine-readable `code` (e.g. `"protocol_error"`) and a human-readable
  `message`, and does not crash the process with an unhandled exception. A message arriving
  **before** the required `init` frame is likewise rejected with an error `code`
  (e.g. `"protocol_error"` / `"init_required"`) rather than calling `impl.handle`.

## When / Then — handler / init failure
- **When** `impl.init` rejects, or `impl.handle` throws / its generator rejects mid-iteration:
- **Then** the entrypoint catches the rejection and writes one
  `{ type: "error", value: { code, message } }` frame (for a `handle` failure, `message`
  carries the thrown error's message; `code` is stable, e.g. `"handler_error"`). For an `init`
  failure, **no** `ready` frame is written (consistent with
  `adapter-core-init-ready-handshake.md`). The error frame is terminal for that operation and
  the process does not emit a `done` for a failed `handle`.

## Then — test coverage
- Vitest unit tests in `packages/adapter-core/tests/` cover, via the in-memory seam:
  (1) EOF while idle → clean completion, no error frame;
  (2) SIGTERM → graceful shutdown, idempotent;
  (3) malformed line → single `error` frame with expected `code`, process survives;
  (4) `handle` throwing → single `error` frame, no `done`.
  `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
