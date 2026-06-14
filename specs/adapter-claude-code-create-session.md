---
scenario: "createClaudeCodeAdapter().createSession() materializes a real Claude Code session by spawning `claude -p <initialQuery> --output-format stream-json --verbose --dangerously-skip-permissions --max-turns <n>`, parses the streamed `system` line for the CC session id, and returns a NativeSessionRef with the session id as nativeId, plus the initial Turn[] (cached in memory)"
feature: adapter-claude-code
tags: [adapter, claude-code, create-session, cli, native-id, stream-json, phase-3]
---

## Given
- `@sumeru/adapter-claude-code` is built and the test environment has `claude` available on `$PATH` (verified by `which claude` for the integration variant).
- The adapter is constructed with default options: `const adapter = createClaudeCodeAdapter();`.
- Claude Code does NOT have its own session DB at a stable path the adapter can read — the only canonical CC session identifier is the `session_id` field that CC prints in the `{type:"system", subtype:"init"}` line at the start of every `--output-format stream-json --verbose` run.
- Therefore the adapter is the **sole authority** on the per-session Turn[] for the lifetime of the adapter instance: it caches the parsed turns in memory keyed by `nativeId`, and `getTurns(ref)` returns from that cache. (Contrast with `adapter-hermes`, which reads from external state.db / JSONL.)
- The default Claude `--max-turns` is `90` (matching the uwf reference implementation). Configurable via `ClaudeCodeAdapterOptions.maxTurns`.

## When
- Test code calls:
  ```typescript
  const ref = await adapter.createSession({
    model: "claude-sonnet-4-5",
    initialQuery: "Say hi.",
  });
  ```
- Internally, the adapter:
  1. Resolves `initialQuery` from `config.initialQuery`. If absent or empty string, defaults to `"ping"` (matches adapter-hermes behavior — every session is born with a probe message).
  2. Resolves `model` from `config.model` (per-call) OR from constructor `options.model` (per-adapter). Per-call wins. If both absent, `--model` is NOT passed and CC uses its own default.
  3. Builds argv: `["-p", initialQuery, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--max-turns", String(maxTurns)]`. If a model is set, appends `["--model", model]`.
  4. Spawns the process via `spawnFn` (default: `child_process.spawn` wrapper at `src/spawn.ts`) with `cwd: options.cwd ?? process.cwd()`. Captures stdout (the NDJSON stream) and stderr.
  5. Awaits process exit.
  6. Calls `parseStreamJson(stdout)`. If `null`, throws (see "Unparseable" below).
  7. Stores `parsed.turns` in an in-memory `Map<string, Turn[]>` keyed by `parsed.sessionId`.
  8. Returns `{ nativeId: parsed.sessionId, meta: { model: parsed.model || (resolved model) || null, cwd: <cwd used>, createdAt: <ISO-8601 of call time>, subtype: parsed.subtype } }`.
- A second test calls `createSession({})` (empty config). The adapter must still produce a valid session, sending the default `"ping"` query so CC actually emits a `system` line.
- A third test points the adapter at a non-existent binary (`createClaudeCodeAdapter({ claudeBin: "/nonexistent/claude" })`) and calls `createSession({})`.
- A fourth test stubs `spawnFn` to produce stdout containing only blank lines (no system, no result). The adapter must reject.
- A fifth test stubs `spawnFn` to produce a stream where the result line has `subtype: "error_max_turns"`. createSession MUST still resolve (the session was created — it just hit the cap on turn 1) and the returned `meta.subtype === "error_max_turns"`. Callers can decide what to do with that.

## Then
- **Happy path** — the returned `NativeSessionRef` has:
  - `nativeId` matching the CC session-id format `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` (UUID v4) — this is the format CC's stream-json `system.session_id` field uses. The adapter does NOT validate the UUID by spec — it accepts whatever non-empty string CC printed — but the test asserts the format on real-CC integration runs.
  - `meta.cwd` is the resolved working directory.
  - `meta.model` matches what the test passed in (or what CC echoed in the `system` line if the caller did not specify).
  - `meta.createdAt` is ISO-8601 UTC within 30 s of the call.
  - `meta.subtype` is one of `"success" | "error_max_turns" | "error_budget" | "incomplete"`.
- **In-memory turn cache populated** — Calling `adapter.getTurns(ref)` immediately after `createSession` returns returns a non-empty `Turn[]`. The first turn (`index: 0`) is the user's initial query (or, per the parser spec, may be the assistant's response if the implementation chose not to emit the synthetic user turn — the test must align with the parser's choice). At least one assistant turn is present.
- **Empty config** — `createSession({})` succeeds. `meta.model` is `null` if the constructor did not pin one; otherwise the constructor value.
- **Bad binary** — `createSession({})` rejects with an `Error` whose message includes both the literal `"claude"` token and the path that failed (e.g. `/nonexistent/claude`). No `NativeSessionRef` is returned. The error is **not** swallowed.
- **Unparseable output** — If `parseStreamJson(stdout)` returns `null`, the adapter rejects with an `Error("claude code returned unparseable stream-json output (first 500 chars: <stdout-head>)")`. The error message includes both stdout head AND stderr tail (last 500 chars) for debugging.
- **Non-zero exit (with parseable stream)** — If `claude` exits non-zero BUT `parseStreamJson` succeeds (CC sometimes exits non-zero after emitting a partial stream), the adapter prefers the parsed result over the exit code: it still resolves with a `NativeSessionRef`, and `meta.subtype` reflects the actual stream state (most likely `"incomplete"`). A warning is logged. (This matches the uwf reference's "stdout truncation" pitfall.)
- **Non-zero exit AND unparseable** — Reject with an `Error` whose message includes the exit code and the last 500 chars of stderr.
- **Login / API key errors** — If stderr contains `/not logged in/i`, the rejection message is `"claude code is not logged in. Run \`claude login\` first."` and includes the exit code. If stderr contains `/invalid api key|ANTHROPIC_API_KEY|authentication|unauthorized/i`, the rejection message is `"claude code API key error. Check your API key configuration."` and includes the exit code. (Ports `mapClaudeError` from the uwf reference.)
- **Max-turns on init** — `meta.subtype === "error_max_turns"` is **NOT an error** at this layer. The session was created; the resource cap was reached on the very first response. Callers (the server, eventually) may want to surface this — but the adapter resolves cleanly. (Matches issue's "Map error_max_turns to a recoverable state, not an error.")
- **Concurrency** — Two parallel `await Promise.all([adapter.createSession({}), adapter.createSession({})])` calls return two distinct `nativeId`s (each is a separate spawn — CC mints a fresh UUID per run). Nothing in the adapter holds a global lock that serializes them.
- **Timeout** — `createSession` honors a default 5 m timeout per call (configurable via `ClaudeCodeAdapterOptions.createSessionTimeoutMs`, default `5 * 60_000`). On timeout: spawned process killed with `SIGTERM` then `SIGKILL` 5 s later; promise rejects with `Error("createSession timed out after <ms>ms")`; no orphan process remains 2 s later.
- **No leakage in meta** — `meta` does NOT contain API keys, paths to auth files, or any field with a substring matching `/sk-ant-|api[_-]?key/i`. Only the explicitly listed keys (`cwd`, `model`, `createdAt`, `subtype`) appear.
- **Cache scope** — The in-memory `Map<string, Turn[]>` is **per adapter instance**. A second `createClaudeCodeAdapter()` call has an empty cache. (Matches the closed-ref Set scope semantics from `adapter-hermes-close.md`.)
- **Argv hygiene** — `initialQuery` is passed via argv (NOT shell interpolation). Embedded quotes, backslashes, newlines, and emoji round-trip without corruption. Verified with `initialQuery: "line1\nline2 中文 🍊 \"quoted\""`.
- **No `--cwd` flag** — The adapter sets cwd via `child_process.spawn`'s `cwd` option, NOT via a CC CLI flag (CC does not have a `--cwd` flag).
- **Tests** under `packages/adapter-claude-code/tests/create-session.test.ts`:
  - Default suite uses **mocked `spawnFn`** that returns canned stdout/stderr/exit values. Verifies argv composition, in-memory cache population, error-mapping for login/api-key/non-zero/unparseable, timeout, and unicode argv handling.
  - One opt-in integration test (gated on `process.env.SUMERU_CLAUDE_CODE_INTEGRATION === "1"`) runs against a real local `claude`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
