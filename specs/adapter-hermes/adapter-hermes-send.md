---
scenario: "createHermesAdapter().send() forwards a user message to an existing Hermes session via `hermes chat -q --resume <id>`, returns the new turns produced by the agent, and supports session resume across calls"
feature: adapter-hermes
tags: [adapter, hermes, send, resume, turns, cli, phase-3]
---

## Given
- `@sumeru/adapter-hermes` is built and `hermes` is available on `$PATH`.
- An adapter-managed session exists: `const ref = await adapter.createSession({ model: "anthropic/claude-haiku-4" })`.
- The Hermes session DB at `~/.hermes/sessions.db` already contains the session row created above; `getTurns(ref)` (specced separately) can read its existing turns.
- For determinism, all tests use a model that gives short, deterministic answers (`anthropic/claude-haiku-4` or a stubbed model in unit tests).

## When
- The test calls:
  ```typescript
  const r1 = await adapter.send(ref, "My favorite number is 42. Please remember it.");
  const r2 = await adapter.send(ref, "What is my favorite number? Reply with just the digits.");
  ```
- Internally each call:
  1. Records the **highest existing turn index** in the session before invoking Hermes (via `getTurns(ref)` or a direct DB read — implementation detail).
  2. Spawns `hermes chat -q "<content>" --resume <ref.nativeId> --quiet --pass-session-id --source <sourceTag>` (model is NOT re-passed because Hermes pins the model on first creation; passing it on resume is a no-op or error depending on hermes version, so the adapter omits it).
  3. Waits for the process to exit.
  4. Re-reads the session turns and returns the **delta** — turns whose index is greater than the recorded high-water mark.

## Then
- **Resume works (the issue's first completion criterion)** — `r2.turns` contains an assistant message whose `content` includes the substring `"42"`. The model genuinely sees the prior conversation context. (This is the test that proves Hermes resume actually works through the adapter.)
- **Return shape** — Each `AgentResponse` has:
  - `turns: Turn[]` — the **new turns from this `send` call only**, not the entire history. Order is by `index` ascending, matching `Turn.index`.
  - `tokens: TokenUsage | null` — sum of input/output tokens across the new turns; `null` only if Hermes did not report any token usage for any of them (rare edge case).
  - `durationMs: number` — wall-clock time from `spawn` to process exit, integer.
- **Turn shape per `@sumeru/core`** — Every emitted turn has:
  - `index: number` — the absolute index in the Hermes session (not relative to this `send` call).
  - `role: "user" | "assistant"` — adapter MUST emit at least one `role: "user"` turn (the message just sent) and at least one `role: "assistant"` turn (Hermes's reply). System messages from Hermes are filtered out unless `HermesAdapterOptions.includeSystemTurns === true` (default `false`).
  - `content: string` — text content; never `undefined`, never `null`.
  - `timestamp: string` — ISO-8601 UTC; matches the value Hermes wrote to its DB.
  - `toolCalls: ToolCall[] | null` — full tool-call records for assistant turns that used tools; `null` when no tool calls were made (NOT `[]`).
  - `tokens: TokenUsage | undefined` — the existing `Turn.tokens?` shape from `@sumeru/core` is preserved. (Note: a sibling task may convert this to `T | null`; if that happens, both core and adapter update together.)
- **Tool-call passthrough (the issue's "含 toolCalls" requirement)** — If the model invokes a tool (e.g. asks Hermes to run `terminal: ls`), the resulting turn's `toolCalls` is a non-empty array; each `ToolCall` has `tool`, `input`, `output`, `durationMs`, and `exitCode` populated from the Hermes record. None of these fields are dropped or renamed. (Tested with `initialQuery: "Run \\`echo hi\\` in the terminal tool, then tell me the output."`)
- **No turn duplication across `send` calls** — `r1.turns` and `r2.turns` have no overlapping `index` values. Assert: `new Set([...r1.turns, ...r2.turns].map(t => t.index)).size === r1.turns.length + r2.turns.length`.
- **Session status side effects** — The adapter does NOT mutate the upstream `Session` (Sumeru-side) state — that's the server's responsibility. Adapter just shells out and reads turns.
- **Concurrent send on the same ref** — Two parallel `send(ref, ...)` calls are **serialized inside the adapter** via a per-`nativeId` mutex. The second call awaits the first; the result of the second sees the first's turns. Neither rejects with `409` (that's a Sumeru-server-layer concern, not adapter). The adapter exposes no 409-like contract.
- **Send to closed session** — If `ref.nativeId` was previously closed via `adapter.close(ref)`, calling `send(ref, …)` rejects with `Error("hermes session <id> is closed")`. (The adapter tracks closed refs in an internal `Set<string>` for the lifetime of the adapter instance.)
- **Send to never-created session** — If `ref.nativeId` is a syntactically valid string that does NOT exist in the Hermes DB, `send` rejects with an `Error` whose message includes the id and the substring `"not found"`. (Hermes itself errors out; the adapter surfaces that.)
- **Unicode / multiline content** — The adapter passes `content` to `hermes chat -q "<content>"` using argv (NOT shell interpolation), so embedded quotes, backslashes, newlines, and emoji round-trip without corruption. Verified with content `"line1\nline2\n中文 🍊 \"quoted\""`.
- **Timeout** — `send` honors a per-call timeout (default 5 minutes, configurable via `HermesAdapterOptions.sendTimeoutMs`). On timeout: the spawned `hermes` process is killed (`SIGTERM`, then `SIGKILL` after 5 s); the promise rejects with `Error("send timed out after <ms>ms")`; turns produced **before** the timeout are NOT returned (they are still in the DB and can be retrieved by a subsequent `getTurns`).
- **Non-zero exit** — `hermes` exiting non-zero rejects the promise with `Error("hermes exited with code <n>: <stderr tail>")`. No partial turns are returned.
- **Tests** under `packages/adapter-hermes/tests/send.test.ts`:
  - Resume context test (`r2` sees `42`) — gated on `SUMERU_HERMES_INTEGRATION=1`.
  - Default suite uses a stubbed `spawn` that fakes Hermes output and a stubbed turns reader; verifies argv, mutex, closed-ref rejection, timeout, and unicode argv handling.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
