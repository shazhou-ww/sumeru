---
scenario: "sumeru start writes ~/.sumeru/sumeru.pid on launch, validates it on restart, and removes it on graceful shutdown"
feature: cli-start
tags: [cli, pid-file, lifecycle, restart]
---

## Given
- `pnpm run build` has been run successfully from the repo root.
- The user's home directory is writable and `~/.sumeru/` either does not exist or is a directory (Sumeru creates it with `mkdir -p` permissions `0o700` if missing).
- The PID file path is `~/.sumeru/sumeru.pid` (overridable via `SUMERU_PID_FILE` environment variable for tests; flag-level override is **not** in scope for this spec).
- No prior `sumeru.pid` exists at the path.

## When
- The operator runs `sumeru start --port 0`.

## Then
- Before binding the HTTP listener, Sumeru writes the file `~/.sumeru/sumeru.pid` containing exactly `<pid>\n` (the running process's pid as decimal ASCII, followed by a single newline; no JSON, no extra whitespace).
- File permissions are `0o600` (owner read/write only).
- The directory `~/.sumeru/` is created if missing, with permissions `0o700`.
- On graceful shutdown (SIGTERM/SIGINT path defined in `cli-graceful-shutdown.md`), Sumeru deletes `~/.sumeru/sumeru.pid` **after** `server.stop()` resolves and **before** `process.exit(0)`.
- If the PID file cannot be deleted on shutdown (e.g. it was already removed), the failure is logged to stderr as `[sumeru] could not remove pid file: <message>` but does NOT affect exit code (still `0`).

## When (variant: stale PID file from a crashed predecessor)
- A prior `sumeru.pid` exists containing a pid that is **not** running (e.g. process was SIGKILL'd; `process.kill(pid, 0)` throws `ESRCH`).
- The operator runs `sumeru start --port 0`.

## Then (variant: stale PID file)
- Sumeru detects the stale pid (`process.kill(pid, 0)` → `ESRCH`), logs `[sumeru] removing stale pid file (pid <stalepid> not running)` to stderr, overwrites the file with the new pid, and proceeds with normal startup.

## When (variant: live PID file from a running predecessor)
- A prior `sumeru.pid` exists containing a pid that IS still running (`process.kill(pid, 0)` succeeds).
- The operator runs `sumeru start --port 0`.

## Then (variant: live PID file)
- Sumeru exits `1` before binding any port. stderr contains:
  ```
  Another sumeru appears to be running (pid <livepid>, recorded in ~/.sumeru/sumeru.pid).
    Stop it first, or run `sumeru start … --force` to terminate it.
  ```
- If `--force` is passed, Sumeru reuses the kill flow from `cli-startup-port-check.md` (SIGTERM, 2s wait, SIGKILL) targeting `<livepid>`, then continues with startup and overwrites the PID file.

## When (variant: PID file write fails)
- `~/.sumeru/` is read-only, or the filesystem is full.
- The operator runs `sumeru start --port 0`.

## Then (variant: PID file write fails)
- Sumeru logs a warning `[sumeru] could not write pid file <path>: <message>` to stderr but **continues** to start the HTTP server. The PID file is best-effort — its absence MUST NOT prevent Sumeru from running. The exit code on a successful start is still `0` (eventually, on graceful shutdown).

## Notes
- Implementation hint: a small module `packages/cli/src/pid-file.ts` exporting `writePidFile()`, `readPidFile()`, `removePidFile()`, and `isProcessAlive(pid)`. Use `process.kill(pid, 0)` for liveness — it sends no signal but throws `ESRCH` for dead pids and `EPERM` for live-but-foreign pids (both treated as "live" for safety).
- The PID file path resolution follows the same `~` expansion as `resolveOcasDir` in `packages/server/src/start.ts`.
- Tests: unit tests for `pid-file.ts` should cover stale pid detection (`process.kill(99999999, 0)` → ESRCH), permission errors (write to `/proc/sys/`-style read-only path), and roundtrip write/read/remove. An integration test should spawn two `sumeru start` processes back-to-back and assert the second exits `1` with the documented message.
