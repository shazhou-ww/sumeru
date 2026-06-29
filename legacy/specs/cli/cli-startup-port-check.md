---
scenario: "sumeru start surfaces a helpful diagnostic and a --force option when the bind port is already held"
feature: cli-start
tags: [cli, startup, port, diagnostics, eaddrinuse]
---

## Given
- `pnpm run build` has been run successfully from the repo root.
- A previous Sumeru (or any other process) is currently bound to TCP port `7900` on `127.0.0.1`. Its pid is `$OTHER_PID`.
- `lsof` is available on `PATH` (Sumeru's runtime environment is Linux/macOS — `lsof -i :7900 -sTCP:LISTEN -t` returns `$OTHER_PID`).
- `sumeru start --help` documents a new flag `--force` whose description is `Kill any process holding the chosen port before binding (sends SIGTERM, then SIGKILL after 2s)`.

## When
- The operator runs `sumeru start --port 7900` (without `--force`).

## Then
- The process exits with a non-zero code (`1`).
- stderr contains a single block matching this shape (whitespace tolerant, exact tokens required):
  ```
  Port 7900 is already in use on 127.0.0.1.
    Held by pid <OTHER_PID> (<command>)
    Run `sumeru start --port 7900 --force` to terminate it, or pick a different --port.
  ```
  where `<command>` is the basename of the holder's executable (e.g. `node`) when discoverable; if `lsof` fails or the holder cannot be identified, the line `Held by pid …` is omitted (but the rest of the block remains).
- If `lsof` is **not** on PATH, the diagnostic falls back to the legacy single-line message (`Port 7900 is already in use on 127.0.0.1. Choose a different --port or stop the conflicting process.`) and exits `1` — **no crash, no stack trace**.
- The error message MUST NOT leak any `node:net` / `node:http` internal stack trace to stderr.

## When (variant: --force)
- The operator runs `sumeru start --port 7900 --force` and `$OTHER_PID` is still bound to port 7900.

## Then (variant: --force)
- Sumeru sends `SIGTERM` to `$OTHER_PID`, waits up to **2 seconds** for the port to free, and if it remains bound, sends `SIGKILL`.
- A line `[sumeru] killed pid <OTHER_PID> holding port 7900` is written to stderr.
- After the port is free, Sumeru proceeds with normal startup and prints `Listening on http://127.0.0.1:7900` on stdout.
- If `$OTHER_PID` cannot be killed (e.g. `EPERM` because it belongs to another user), Sumeru exits `1` with stderr `Failed to kill pid <OTHER_PID>: <reason>` and does **not** attempt to bind.
- `--force` without an actual port conflict is a no-op (no kill attempts, no warning) — Sumeru just starts normally.

## Notes
- Implementation hint: factor the port-conflict diagnostic into a helper (e.g. `packages/cli/src/port-check.ts`) so it can be unit-tested without spawning processes. The helper takes `(host, port)` and returns `{ pid: number, command: string } | null`.
- The diagnostic flow is triggered by catching `EADDRINUSE` from `startServer` — same trap point as today, just richer output and an optional kill step.
- Tests: a Vitest integration test should occupy port 7900 with a sibling `net.createServer().listen(7900)`, then spawn `sumeru start --port 7900` and `sumeru start --port 7900 --force` and assert the documented output / exit codes.
