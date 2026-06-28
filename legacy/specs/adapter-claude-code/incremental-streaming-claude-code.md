---
scenario: "adapter-claude-code implements true incremental streaming: streaming spawn, incremental NDJSON parser, and send() that yields turns before process exit"
feature: adapter-claude-code
tags: [adapter, claude-code, streaming, incremental, ndjson, spawn]
---

## Given
- `@sumeru/adapter-claude-code` send() currently collects all stdout after process exit, batch-parses via `parseStreamJson(result.stdout)`, then yields all turns at once — fake streaming.
- `defaultSpawn` in `spawn.ts` returns `Promise<SpawnResult>` where `SpawnResult.stdout` is a complete string available only after the child process exits.
- `parseStreamJson` in `stream-parser.ts` takes a full `stdout: string`, splits into lines, iterates synchronously via `processLine()`, and returns `ClaudeCodeParsedResult | null`.
- Internal functions `processLine()`, `processSystemLine()`, `processAssistantLine()`, `processUserLine()`, `assembleResult()` already process lines individually — they just aren't exposed as an incremental interface.
- `types.ts` defines `SpawnFn`, `SpawnArgs`, `SpawnResult`, `ClaudeCodeAdapterOptions`.
- `turnsCache: Map<string, Turn[]>` is only updated after process exit (inside `withRefLock`, after `runClaude` resolves).
- The streaming adapter contract (`specs/architecture/streaming-adapter-contract.md`) and the target behavior (`specs/adapter-claude-code/streaming-adapter-claude-code-send.md`) are already specified — this spec details the implementation mechanism.
- Claude Code emits NDJSON lines: `system` (session_id, model), `assistant` (message with text/tool_use content), `user` (initial prompt or tool_result), `result` (usage, duration, subtype).

## When
The contributor modifies `packages/adapter-claude-code/src/types.ts`, `spawn.ts`, `stream-parser.ts`, and `adapter.ts`:

### types.ts — new types

- Add `SpawnExitInfo`:
  ```typescript
  type SpawnExitInfo = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    durationMs: number;
    stderr: string;
  };
  ```
- Add `SpawnStreamResult`:
  ```typescript
  type SpawnStreamResult = {
    lines: AsyncIterable<string>;
    waitForExit(): Promise<SpawnExitInfo>;
  };
  ```
- Add `StreamingSpawnFn`:
  ```typescript
  type StreamingSpawnFn = (args: SpawnArgs) => SpawnStreamResult;
  ```
- Add `StreamParseEvent` discriminated union:
  ```typescript
  type StreamParseEvent =
    | { type: "turn"; turn: Turn }
    | { type: "meta"; sessionId: string; model: string }
    | { type: "result"; resultLine: Record<string, unknown> };
  ```
- Add `streamingSpawnFn: StreamingSpawnFn | null` to `ClaudeCodeAdapterOptions`.

### spawn.ts — new streaming spawn function

- Add `defaultStreamingSpawn: StreamingSpawnFn` that:
  - Spawns the child process with `node:child_process.spawn` (same options as `defaultSpawn`: `stdio: ["ignore", "pipe", "pipe"]`, `shell: false`).
  - Wraps `child.stdout` with `node:readline.createInterface` to produce line-by-line output.
  - Returns `{ lines, waitForExit() }` where `lines` is an `AsyncIterable<string>` from the readline interface (each yield is one complete line) and `waitForExit()` returns a `Promise<SpawnExitInfo>` that resolves when the child process exits (with exitCode, signal, stderr, timedOut, durationMs).
  - Supports the same timeout mechanism as `defaultSpawn` — on timeout, sends SIGTERM, then SIGKILL after 5s grace; `timedOut` is set to `true` in the exit info.
  - `stderr` is buffered and available in `SpawnExitInfo` after exit.
- The existing `defaultSpawn` (batch) is unchanged — `createSession` continues to use it.

### stream-parser.ts — incremental parser

- Add `parseStreamJsonIncremental(lines: AsyncIterable<string>): AsyncGenerator<StreamParseEvent>`:
  - Creates a `ParseState` (same shape as the existing internal state: `turns`, `pendingToolCalls`, `resultLine`, `model`, `sessionId`, `turnIndex`, `now`).
  - Iterates the `lines` async iterable. For each line, calls the existing `processLine(line, state)`.
  - After each `processLine` call, checks if new turns were added to `state.turns` (comparing length before/after). For each new turn, yields `{ type: "turn", turn }`.
  - After the first `system` line sets `state.sessionId` and `state.model`, yields `{ type: "meta", sessionId, model }`.
  - After `processLine` sets `state.resultLine` (non-null), yields `{ type: "result", resultLine: state.resultLine }`.
  - Tool-result `user` lines fill in `ToolCall.output` on already-yielded Turn objects via the shared `pendingToolCalls` reference — no new event is yielded for tool_result lines.
- The existing `parseStreamJson(stdout: string)` is unchanged (stays synchronous). Both functions share the same internal `processLine()`, `processSystemLine()`, `processAssistantLine()`, `processUserLine()`, `assembleResult()` functions.

### adapter.ts — send() rewrite

- `createClaudeCodeAdapter` reads `options.streamingSpawnFn ?? defaultStreamingSpawn` into a local `streamingSpawnFn` variable (alongside the existing `spawnFn` for `createSession`).
- `send()` is rewritten:
  - Pre-checks remain synchronous (assertRef, closedRefs, content validation).
  - The async generator acquires the `withRefLock` for the entire streaming duration (lock acquired before spawn, released after process exit and done event).
  - Inside the lock: starts the streaming spawn via `streamingSpawnFn({ command, args, timeoutMs, cwd })`.
  - Feeds `spawnStreamResult.lines` into `parseStreamJsonIncremental()`.
  - For each `{ type: "turn", turn }` event from the incremental parser:
    - Rewrites the turn's index using the highWater mechanism (globally monotonic).
    - Appends the rewritten turn to `turnsCache` immediately.
    - Yields `{ type: "turn", turn: rewrittenTurn }` to the consumer.
  - After the line iteration completes, awaits `spawnStreamResult.waitForExit()` for exit info.
  - If exit info indicates timeout: yields `{ type: "error", error }`. Already-yielded turns remain in cache.
  - If exit info indicates non-zero exit: yields `{ type: "error", error }` with diagnostic message. Already-yielded turns remain in cache.
  - On success: derives `TokenUsage` from the `result` event's `resultLine` (same `deriveTokens` logic). Yields `{ type: "done", durationMs, tokens }`.
  - On spawn failure (process fails to start): yields `{ type: "error", error }`.
- `createSession()` continues using the batch `spawnFn` + `parseStreamJson` (no streaming needed for "ping").
- `runClaude()` remains for `createSession` use; send() no longer calls `runClaude()`.

### Tests

- Add a test in `packages/adapter-claude-code/tests/` that verifies turns are yielded BEFORE the process exits:
  - Creates a mock `StreamingSpawnFn` that emits NDJSON lines with artificial delays (e.g. 50ms between lines) and sets an `exited` flag when the exit promise resolves.
  - Calls `adapter.send(ref, content)`.
  - For each yielded `SendEvent`, records whether `exited` was true or false at that point.
  - Asserts that `{ type: "turn" }` events were received when `exited` was `false`.
  - Asserts that `{ type: "done" }` event was received when `exited` was `true`.
- Add a test that verifies `turnsCache` is updated mid-stream:
  - Uses the same mock `StreamingSpawnFn` with delays.
  - After receiving the first turn event, calls `adapter.getTurns(ref)` and asserts it returns the just-yielded turn.
  - After the stream completes, calls `adapter.getTurns(ref)` and asserts all turns are present.
- Existing send tests updated to mock `streamingSpawnFn` instead of `spawnFn`.

## Then
- `createClaudeCodeAdapter()` returns an `Adapter` whose `send` yields `{ type: "turn", turn }` events **incrementally as each turn is parsed from stdout** — the consumer receives turns before the claude process has exited.
- Each yielded turn has a globally monotonic index (continuing from the session's highWater).
- Each yielded turn is appended to `turnsCache` immediately — `getTurns` returns all turns yielded so far, even mid-stream.
- After the process exits, yields exactly one `{ type: "done", durationMs, tokens }`.
- On failure mid-stream (non-zero exit, timeout, spawn failure): yields `{ type: "error", error }`. Turns yielded before the error remain in the cache.
- Tool-result user lines fill in `ToolCall.output` on previously-yielded Turn objects via reference sharing (the same `ToolCall` object is in both `turnsCache` and `pendingToolCalls`).
- The `withRefLock` mechanism continues to serialize concurrent sends — the lock is held for the full streaming duration.
- `createSession` is unchanged — continues using batch spawn + batch parser.
- `parseStreamJsonIncremental` yields the same turns as `parseStreamJson` for identical input (verified by test).
- The incremental parser is tolerant: malformed lines are silently skipped (same as batch parser).
- `defaultStreamingSpawn` handles timeout with SIGTERM → SIGKILL escalation (same as `defaultSpawn`).
- Tests prove turns arrive before process exit (not just before `done` event).
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
