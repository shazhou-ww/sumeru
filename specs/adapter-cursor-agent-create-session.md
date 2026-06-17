---
scenario: "createCursorAgentAdapter().createSession() materializes a session by spawning `cursor-agent -p <initialQuery> --print --output-format stream-json --trust --force --workspace <cwd>`, parses the system line for session_id, and returns a NativeSessionRef with the session id as nativeId"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, create-session, cli, native-id, stream-json]
---

## Given
- `@sumeru/adapter-cursor-agent` is built and the test environment has `cursor-agent` available on `$PATH` (verified by `which cursor-agent` for the integration variant).
- The adapter is constructed with default options: `const adapter = createCursorAgentAdapter();`.
- cursor-agent requires `--print` and `--trust` for headless operation (verified by spike). Without `--trust`, the run aborts.
- The adapter is the **sole authority** on the per-session Turn[] for the lifetime of the adapter instance: it caches the parsed turns in memory keyed by `nativeId`, and `getTurns(ref)` returns from that cache (mirrors adapter-claude-code architecture).
- `CURSOR_API_KEY` environment variable must be set (cursor-agent requires it for authentication).

## When
- Test code calls:
  ```typescript
  const ref = await adapter.createSession({
    model: "sonnet-4",
    initialQuery: "Say hi.",
  });
  ```
- Internally, the adapter:
  1. Resolves `initialQuery` from `config.initialQuery`. If absent or empty string, defaults to `"ping"`.
  2. Resolves `model` from `config.model` (per-call) OR from constructor `options.model` (per-adapter). Per-call wins. If both absent, `--model` is NOT passed and cursor-agent uses its own default.
  3. Builds argv: `["-p", initialQuery, "--print", "--output-format", "stream-json", "--trust"]`. Appends permission flag: `"--force"` (default) or `"--yolo"` based on `options.permissionMode`. If model is set, appends `["--model", model]`. Appends `["--workspace", resolvedCwd]`.
  4. If `options.sandbox` is non-null, appends `["--sandbox", options.sandbox]`.
  5. Spawns the process via `spawnFn` (default: `child_process.spawn` wrapper at `src/spawn.ts`) with `cwd: options.cwd ?? process.cwd()`. Captures stdout (the NDJSON stream) and stderr.
  6. Awaits process exit.
  7. Calls `parseStreamJson(stdout)`. If `null`, throws.
  8. Stores `parsed.turns` in an in-memory `Map<string, Turn[]>` keyed by `parsed.sessionId`.
  9. Returns `{ nativeId: parsed.sessionId, meta: { model: parsed.model || (resolved model) || null, cwd: <cwd used>, createdAt: <ISO-8601 of call time>, subtype: parsed.subtype } }`.
- A second test calls `createSession({})` (empty config). The adapter must still produce a valid session, sending the default `"ping"` query.
- A third test points the adapter at a non-existent binary (`createCursorAgentAdapter({ cursorAgentBin: "/nonexistent/cursor-agent" })`) and calls `createSession({})`.
- A fourth test stubs `spawnFn` to produce stdout containing only blank lines. The adapter must reject.

## Then
- **Happy path** — the returned `NativeSessionRef` has:
  - `nativeId` matching a UUID format (the `session_id` from cursor-agent's system init event). The adapter does NOT validate UUID by spec — it accepts whatever non-empty string cursor-agent printed.
  - `meta.cwd` is the resolved working directory.
  - `meta.model` matches what the test passed in (or what cursor-agent echoed in the system line if the caller did not specify).
  - `meta.createdAt` is ISO-8601 UTC within 30 s of the call.
  - `meta.subtype` is one of `"success" | "incomplete"`.
- **In-memory turn cache populated** — Calling `adapter.getTurns(ref)` immediately after `createSession` returns a non-empty `Turn[]`. At least one assistant turn is present.
- **Empty config** — `createSession({})` succeeds. `meta.model` is `null` if the constructor did not pin one; otherwise the constructor value.
- **Bad binary** — `createSession({})` rejects with an `Error` whose message includes the path that failed. No `NativeSessionRef` is returned.
- **Unparseable output** — If `parseStreamJson(stdout)` returns `null`, the adapter rejects with an `Error` whose message includes stdout head (first 500 chars) AND stderr tail (last 500 chars).
- **Non-zero exit AND unparseable** — Reject with an `Error` whose message includes the exit code and the last 500 chars of stderr.
- **API key errors** — If stderr contains `/CURSOR_API_KEY|authentication|unauthorized|api.?key/i`, the rejection message is `"cursor-agent API key error. Check your CURSOR_API_KEY configuration."` and includes the exit code.
- **Trust errors** — If stderr contains `/trust|untrusted|workspace not trusted/i`, the rejection message is `"cursor-agent requires --trust for headless operation."`.
- **Concurrency** — Two parallel `createSession` calls return two distinct `nativeId`s. Nothing serializes them.
- **Timeout** — `createSession` honors default 5 min timeout. On timeout: process killed with `SIGTERM` then `SIGKILL` 5 s later; promise rejects with `Error("createSession timed out after <ms>ms")`.
- **Argv includes --workspace** — The `--workspace` flag is always present with the resolved cwd path. cursor-agent uses this to set its working directory context.
- **Argv includes --trust and permission flag** — `--trust` and `--force` (or `--yolo`) are always present in headless mode.
- **Argv hygiene** — `initialQuery` is passed via argv (NOT shell interpolation). Embedded quotes, backslashes, newlines, and emoji round-trip without corruption.
- **Tests** under `packages/adapter-cursor-agent/tests/create-session.test.ts`:
  - Default suite uses **mocked `spawnFn`** that returns canned stdout/stderr/exit values. Verifies argv composition, in-memory cache population, error-mapping for api-key/trust/non-zero/unparseable, timeout, and unicode argv handling.
  - One opt-in integration test (gated on `process.env.SUMERU_CURSOR_AGENT_INTEGRATION === "1"`) runs against a real local `cursor-agent`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
