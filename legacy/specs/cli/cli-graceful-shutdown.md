---
scenario: "sumeru start handles SIGTERM/SIGINT gracefully — closes HTTP server, logs shutdown, exits cleanly"
feature: cli-start
tags: [cli, server, shutdown, signal, lifecycle]
---

## Given
- `pnpm run build` has been run successfully from the repo root.
- `@sumeru/cli` exposes the `start` subcommand that boots a `@sumeru/server` HTTP listener (see `server-start-listens.md`).
- A `sumeru start --port 0` process is running in the foreground and has printed `Listening on http://127.0.0.1:<port>` to stdout.
- The process has at least one bound TCP listener and no active sessions (Phase 0 baseline).
- The pid of the running process is captured as `$PID`.

## When
- The operator sends a graceful termination signal: `kill -TERM $PID` (SIGTERM) **or** `kill -INT $PID` (SIGINT, equivalent to Ctrl-C in the foreground).

## Then
- Within **2 seconds** of receiving the signal, the process exits with code `0`.
- Before exiting, the process writes a single shutdown line to stderr matching the regex `^\[sumeru\] shutting down \((SIGTERM|SIGINT)\)\.\.\.$` — the signal name MUST match the signal received.
- After exit, the bound TCP port is fully released — a brand-new `sumeru start --port <same-port>` invocation succeeds without `EADDRINUSE` (allow up to 1 second of OS-level `TIME_WAIT` tolerance, but no longer).
- No child `node` process linked to the original pid remains in `ps -o pid,ppid,cmd` output (no zombies, no orphans).
- If the same signal is received a **second time** during shutdown, the process MUST force-exit with code `130` (SIGINT convention) or `143` (SIGTERM convention) immediately, so the operator can always escape a hung shutdown with a second Ctrl-C.
- A `SIGKILL` (`kill -9 $PID`) is **out of scope** for graceful behavior — the process cannot trap it — but the spec for the next start (`cli-startup-port-check.md`) covers recovery from a SIGKILL'd predecessor.
- The shutdown path MUST `await server.stop()` (already exposed by `startServer`) before calling `process.exit` — this guarantees in-flight HTTP requests finish or are cleanly aborted, and the ocas store is closed.
- If `server.stop()` rejects, the error message is printed to stderr in the form `[sumeru] failed to stop server: <message>` and the process exits with code `1`.

## Notes
- Implementation hint: `process.on("SIGTERM", shutdown)` and `process.on("SIGINT", shutdown)` already exist in `packages/cli/src/cli.ts`, but the current handler does not log the signal name and does not guard against re-entry. Both gaps are in scope.
- Tests: a Vitest integration test under `packages/cli/test/` should spawn `sumeru start --port 0` as a child, wait for the `Listening on …` line, send SIGTERM, then assert exit code `0`, the shutdown log line, and that the port is reusable.
