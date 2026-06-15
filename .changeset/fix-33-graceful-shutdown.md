---
"@sumeru/cli": minor
---

fix: graceful shutdown, port-conflict diagnostics, and PID file lifecycle for `sumeru start` (#33)

`sumeru start` now handles the full process lifecycle correctly:

- **Graceful shutdown** — `SIGTERM`/`SIGINT` log `[sumeru] shutting down (<signal>)…`,
  await `server.stop()`, remove the PID file, and exit `0`. A second signal forces
  exit (`130`/`143`) so a hung shutdown is always escapable.
- **Port-conflict diagnostics** — when the bind port is already held, the CLI
  shells out to `lsof` to identify the holder and prints
  `Held by pid <PID> (<command>)` plus a hint to use `--force`. Falls back
  gracefully if `lsof` is missing.
- **`--force` flag** — sends `SIGTERM` to the holder, waits 2s for the port to
  free, then sends `SIGKILL`, then proceeds with startup.
- **PID file** — written to `~/.sumeru/sumeru.pid` (mode `0o600`, dir `0o700`)
  before bind; removed on graceful shutdown. A stale PID file (process dead) is
  silently overwritten; a live PID file blocks the new start unless `--force`
  is passed. Override via `SUMERU_PID_FILE` for tests.

Two new modules: `packages/cli/src/pid-file.ts` and
`packages/cli/src/port-check.ts`. PID file writes are best-effort — a
read-only home directory degrades to a warning and Sumeru still starts.

Fixes #33.
