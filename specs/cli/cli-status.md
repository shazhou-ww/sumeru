---
scenario: "sumeru status prints instance info, running PID, and gateway health"
feature: cli-status
tags: [cli, status, health]
---

## Given
- `pnpm run build` has been run successfully from the repo root.
- `@sumeru/cli` exposes a new subcommand `status` (read-only; never mutates state or sends signals).
- The PID file path is `~/.sumeru/sumeru.pid` (overridable via `SUMERU_PID_FILE`; same resolution as `cli-pid-file.md`).
- The instance's HTTP endpoint base is `http://127.0.0.1:<port>` where `<port>` is recorded alongside the pid (Phase 0 default `7900`; for tests launched with `--port 0` the actual bound port must be discoverable). Endpoint resolution reuses the same helpers as `cli-stop.md` and `cli-pid-file.md`.
- `GET /` returns the `@sumeru/instance` envelope (`{ name, version, gateways: [...] }`) and `GET /gateways` returns the `@sumeru/gateway-list` envelope (per `server-instance-endpoint.md` and `server-gateways-list-endpoint.md`).

## When
- The operator runs `sumeru status` from any working directory.

## Then (variant: instance running and healthy)
- `sumeru status` reads `~/.sumeru/sumeru.pid`, parses the pid, and confirms the process is alive via `process.kill(pid, 0)` (reusing `isProcessAlive` from `packages/cli/src/pid-file.ts`).
- It issues `GET <endpoint>/` and `GET <endpoint>/gateways` with a short timeout (default **2 seconds** each; overridable via `SUMERU_STATUS_TIMEOUT_MS`).
- It prints to stdout a human-readable block, e.g.:
  ```
  Sumeru is running (pid 12345)
  Instance:  sumeru
  Version:   0.1.0
  Endpoint:  http://127.0.0.1:7900
  Gateways:
    hermes        ready       0 active sessions
    claude-code   ready       2 active sessions
  ```
  - Each gateway line shows: name (left-aligned), `status` from the gateway-list envelope, and `activeSessions` count.
  - A gateway whose `GET /gateways` lookup fails or whose `status` is not `ready` is printed with `status: unreachable` (or the reported non-ready status); a non-fatal warning is emitted on stderr.

## Then (variant: PID file missing)
- `~/.sumeru/sumeru.pid` does not exist.
- `sumeru status` prints exactly `Sumeru is not running` to stdout and exits `0`. No HTTP request is attempted.

## Then (variant: PID file present but process dead)
- The pid in the file fails `process.kill(pid, 0)` (`ESRCH`).
- `sumeru status` prints `Sumeru is not running` to stdout and exits `0`. (The stale file is left in place — cleanup is the responsibility of the next `sumeru start`, per `cli-pid-file.md`.)

## Then (variant: process alive but HTTP endpoint unreachable)
- `process.kill(pid, 0)` succeeds but `GET /` times out or fails (ECONNREFUSED / non-2xx).
- `sumeru status` prints `Sumeru is running (pid <pid>)` followed by `Endpoint unreachable: <reason>` on stderr and exits `0`. The pid-file is **not** modified.

## Notes
- `status` MUST NOT send any signal to the pid (no `SIGTERM`/`SIGKILL`); it is purely diagnostic.
- `--json` flag (out of scope here) is reserved for machine-readable output in a future spec.
- Tests under `packages/cli/test/`:
  - Spawn `sumeru start --port 0`, capture the listening line, run `sumeru status` → asserts the instance name, version, endpoint, and at least one gateway line.
  - No pid file present → stdout is exactly `Sumeru is not running\n`.
  - Pid file pointing at a dead pid (e.g. `99999999`) → stdout is `Sumeru is not running\n`.
