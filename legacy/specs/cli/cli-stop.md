---
scenario: "sumeru stop sends SIGTERM to the running instance"
feature: cli-stop
tags: [cli, stop, shutdown]
---

## Given
- `pnpm run build` has been run successfully from the repo root.
- `@sumeru/cli` exposes a new subcommand `stop` that terminates a running `sumeru` instance via signal.
- The PID file path is `~/.sumeru/sumeru.pid` (overridable via `SUMERU_PID_FILE`; same resolution as `cli-pid-file.md`).
- The CLI accepts `-f, --force` on `sumeru stop`:
  - Without `--force`: send `SIGTERM`, wait up to **5 seconds** for the process to exit.
  - With `--force`: after the 5-second `SIGTERM` grace window, escalate to `SIGKILL`.
- Liveness is checked via `isProcessAlive(pid)` from `packages/cli/src/pid-file.ts` (`process.kill(pid, 0)`).

## When
- The operator runs `sumeru stop` (or `sumeru stop --force`) from any working directory.

## Then (variant: instance running, exits on SIGTERM)
- `sumeru stop` reads `~/.sumeru/sumeru.pid`, parses the pid, and confirms the process is alive.
- It sends `process.kill(pid, "SIGTERM")`.
- It polls `isProcessAlive(pid)` every **100 ms** for up to **5 seconds**.
- When the process exits within the window, `sumeru stop` prints `Sumeru stopped (pid <pid>)` to stdout and exits `0`.
- After the process exits, the pid file is removed by the **running instance itself** on its graceful shutdown path (per `cli-graceful-shutdown.md` / `cli-pid-file.md`); `stop` does **not** delete the pid file. If the file still exists after exit, `stop` leaves it as a stale-file case for the next `start`.

## Then (variant: SIGTERM grace window expires, no --force)
- The process has not exited after 5 seconds.
- Without `--force`, `sumeru stop` prints to stderr:
  ```
  Sumeru did not stop within 5s (pid <pid>). Re-run with --force to SIGKILL.
  ```
- Exit code is `1`. The pid file is not modified.

## Then (variant: --force escalation)
- The process did not exit on `SIGTERM` within 5 seconds and `--force` was passed.
- `sumeru stop` sends `process.kill(pid, "SIGKILL")`, waits a short confirmation window (≤ 500 ms) for the process to disappear, then prints `Sumeru stopped (pid <pid>)` to stdout and exits `0`.

## Then (variant: pid file missing)
- `~/.sumeru/sumeru.pid` does not exist.
- `sumeru stop` prints exactly `Sumeru is not running` to stdout and exits `0`. No signal is sent.

## Then (variant: pid file present but process already dead)
- The pid fails `isProcessAlive(pid)` (`ESRCH`).
- `sumeru stop` prints `Sumeru is not running` to stdout and exits `0`. It does **not** send a signal and does **not** delete the pid file (stale-file cleanup belongs to `sumeru start`, per `cli-pid-file.md`).

## Notes
- `stop` reuses `readPidFile()` and `isProcessAlive()` from `packages/cli/src/pid-file.ts`; no new pid-file helpers are introduced here.
- `stop` does not perform an HTTP request — it is signal-only, so it works even when the HTTP endpoint is hung.
- The 5-second grace window is chosen to match the graceful-shutdown budget documented in `cli-graceful-shutdown.md` (2 s) plus headroom.
- Tests under `packages/cli/test/`:
  - Spawn `sumeru start --port 0`, capture pid, run `sumeru stop` → asserts the process exits, stdout matches `^Sumeru stopped \(pid [0-9]+\)$`.
  - No pid file present → stdout is `Sumeru is not running\n`, exit `0`.
  - Pid file pointing at a dead pid → stdout is `Sumeru is not running\n`, exit `0`.
  - Stub a process that ignores `SIGTERM` for > 5 s, run `sumeru stop` (no `--force`) → stderr ends with the escalation hint, exit `1`; run `sumeru stop --force` → process is gone, exit `0`.
