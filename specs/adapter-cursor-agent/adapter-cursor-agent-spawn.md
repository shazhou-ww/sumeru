---
scenario: "The spawn.ts module wraps child_process.spawn with a timeout, SIGTERM→SIGKILL escalation, and captured stdout/stderr — identical pattern to adapter-claude-code's spawn.ts"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, spawn, process-management]
---

## Given
- `@sumeru/adapter-cursor-agent` is built. The spawn module lives at `packages/adapter-cursor-agent/src/spawn.ts` and exports `defaultSpawn` as a named export conforming to the `SpawnFn` type.
- The implementation is structurally identical to `packages/adapter-claude-code/src/spawn.ts` — it wraps `node:child_process.spawn` with:
  - argv array passed directly (no shell interpolation).
  - `stdio: ["ignore", "pipe", "pipe"]` (stdin closed, stdout/stderr captured).
  - `shell: false` (explicit — no shell expansion).
  - `env: process.env` (inherits current environment, which must include `CURSOR_API_KEY`).
  - Configurable timeout with SIGTERM → 5s grace → SIGKILL escalation.

## When
- The adapter calls `spawnFn({ command: "cursor-agent", args: [...], timeoutMs: 300000, cwd: "/workspace" })`.

## Then
- **Return shape** — `SpawnResult` with fields: `stdout: string`, `stderr: string`, `exitCode: number | null`, `signal: NodeJS.Signals | null`, `timedOut: boolean`, `durationMs: number`.
- **Normal exit** — Process exits 0: `exitCode === 0`, `signal === null`, `timedOut === false`, `stdout` and `stderr` contain the captured output.
- **Non-zero exit** — Process exits non-zero: `exitCode` is the code, `timedOut === false`.
- **Timeout** — Process exceeds `timeoutMs`: `SIGTERM` sent immediately, then `SIGKILL` after 5000ms grace if still alive. `timedOut === true`. Whatever stdout/stderr was captured before kill is still returned.
- **Spawn error** — If the binary does not exist or cannot be executed, the promise rejects with an Error (NOT a SpawnResult with exitCode).
- **No shell** — Argv with special characters (`"`, `\`, `\n`, spaces, emoji) are passed verbatim to the child process without shell expansion.
- **Environment passthrough** — `process.env` is passed as-is, ensuring `CURSOR_API_KEY` and any other cursor-agent-required env vars are available to the child.
- **Timer cleanup** — The timeout timer is `.unref()`'d so it does not keep the Node.js event loop alive if the process exits before timeout.
- **Tests** — spawn.ts is tested indirectly through the adapter tests via injected `spawnFn`. No separate unit test file is required (matching adapter-claude-code convention), but the timeout/kill behavior is verified in `create-session.test.ts` and `send.test.ts`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
