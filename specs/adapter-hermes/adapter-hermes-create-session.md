---
scenario: "createHermesAdapter().createSession() materializes a real Hermes session by running `hermes chat -q --pass-session-id`, parses the printed session ID, and returns a NativeSessionRef"
feature: adapter-hermes
tags: [adapter, hermes, create-session, cli, native-id, phase-3]
---

## Given
- `@sumeru/adapter-hermes` is built and the test environment has `hermes` available on `$PATH` (verified by `which hermes`).
- The adapter is constructed with default options: `const adapter = createHermesAdapter();`.
- The Hermes session DB lives at `~/.hermes/sessions.db` (SQLite). The adapter does NOT touch the DB directly here — it relies entirely on the CLI.

## When
- Test code calls:
  ```typescript
  const ref = await adapter.createSession({
    model: "anthropic/claude-haiku-4",
    systemPrompt: "You are a brevity bot. Reply with one word.",
    initialQuery: "Say hi.",
  });
  ```
- Internally, the adapter:
  1. Builds an argv: `hermes chat -q "<initialQuery>" --pass-session-id --source <sourceTag> --quiet --model <model>` plus any other config keys whose names match a small allow-list (`model`, `provider`, `toolsets`, `skills`, `worktree`, `acceptHooks`, `yolo`, `maxTurns`, `ignoreUserConfig`, `ignoreRules`).
  2. Spawns the process with `child_process.spawn`, captures stdout, waits for exit.
  3. Parses the session ID from a line matching `/^Session:\s+(\S+)$/m` in the captured stdout (the format Hermes prints in `--quiet` mode).
- A second test calls `createSession({})` (empty config) — the adapter must still produce a valid session, sending an empty / minimal probe query so Hermes actually creates a row in the DB.
- A third test points the adapter at a non-existent binary (`createHermesAdapter({ hermesBin: "/nonexistent/hermes-bin" })`) and calls `createSession({})`.

## Then
- **Happy path** — the returned `NativeSessionRef` has:
  - `nativeId` matching `/^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/` (the Hermes session ID format `YYYYMMDD_HHMMSS_<hash>`, e.g. `20260613_173939_44726f`).
  - `meta.sourceTag === "sumeru"` (the value passed via `--source`, defaulting to `"sumeru"`).
  - `meta.cwd === process.cwd()` at the time of the call.
  - `meta.model === "anthropic/claude-haiku-4"` (the model echoed back so `getTurns` / `send` can pass it through on resume).
  - `meta.createdAt` is an ISO-8601 UTC timestamp within 30 s of the call.
  - **No** `nativeId` value of `""`, `null`, or any string failing the regex above ever escapes the adapter — those are treated as adapter-level errors (see below).
- **Empty config** — `createSession({})` succeeds. `meta.model` is `null` (not `undefined`, not the empty string).
- **Resume verification** — Calling `hermes sessions list --source sumeru` (in test setup, before the test) shows the new session ID at the top within 5 s of `createSession` returning. The session count for `--source sumeru` increases by exactly 1.
- **Source tag isolation** — `hermes sessions list --source cli` does NOT include the adapter-created session. (This is why the adapter sets `--source sumeru` by default — keeps the user's CLI session list clean per the issue's "ses_ID ↔ native session ID 映射" intent.)
- **Bad binary** — `createSession({})` rejects with an `Error` whose message includes both `"hermes"` and the path that failed (e.g. `/nonexistent/hermes-bin`). The error is **not** swallowed; no `NativeSessionRef` is returned.
- **Parse failure** — If `hermes` exits 0 but stdout contains no `Session:` line, the adapter rejects with an `Error` mentioning `"failed to parse Hermes session id"` and includes the first 500 chars of captured stdout for debugging. (Tested by stubbing `spawn` in unit tests.)
- **Non-zero exit** — If `hermes` exits non-zero, the adapter rejects with an `Error` whose message contains the exit code and the last 500 chars of stderr.
- **No leakage in meta** — `meta` does NOT contain `auth.json`, `.env`, or any token-shaped field. Only the explicitly listed keys (`sourceTag`, `cwd`, `model`, `createdAt`) appear.
- **Concurrency** — Two parallel `await Promise.all([adapter.createSession({}), adapter.createSession({})])` calls return two distinct `nativeId`s; nothing in the adapter holds a global lock that serializes them.
- **Timeout** — `createSession` honors a default 60 s timeout per call (configurable via `HermesAdapterOptions.createSessionTimeoutMs`, default `60_000`). On timeout the spawned process is killed with `SIGTERM`, the promise rejects with `Error("createSession timed out after 60000ms")`, and no orphan process remains 2 s later.
- Tests live under `packages/adapter-hermes/tests/create-session.test.ts`. The default suite uses **mocked `child_process.spawn`** to avoid requiring a network-bound Hermes call in CI; an opt-in integration test (gated on `process.env.SUMERU_HERMES_INTEGRATION === "1"`) runs against a real local `hermes`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
