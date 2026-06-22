---
scenario: "adapter-codex implements true incremental streaming: streaming spawn, incremental JSONL parser, and send() that yields turns before process exit"
feature: adapter-codex
tags: [adapter, codex, streaming, incremental, jsonl, spawn]
---

## Given
- `@sumeru/adapter-codex` send() currently collects all stdout after process exit, batch-parses via `parseCodexJson(result.stdout)`, then yields all turns at once — fake streaming.
- `defaultSpawn` in `spawn.ts` returns `Promise<SpawnResult>` where `SpawnResult.stdout` is a complete string available only after the child process exits.
- `parseCodexJson` in `stream-parser.ts` takes a full `stdout: string`, splits into lines, iterates synchronously via `processLine()`, and returns `CodexParsedResult | null`.
- Internal functions `processLine()`, `processThreadStarted()`, `processItemCompleted()`, `processTurnCompleted()` already process lines individually — they just aren't exposed as an incremental interface.
- Codex v0.141.0 emits JSONL lines: `thread.started` (thread_id), `turn.started` (no fields), `item.started` (command_execution in_progress), `item.completed` (agent_message text or command_execution result), `turn.completed` (usage with input_tokens/output_tokens).
- The parser handles exactly 5 event types — no tolerance for guessed alternatives needed.
- `types.ts` defines `SpawnFn`, `SpawnArgs`, `SpawnResult`, `CodexAdapterOptions`.
- `turnsCache: Map<string, Turn[]>` is only updated after process exit.

## When
The contributor modifies `packages/adapter-codex/src/types.ts`, `spawn.ts`, `stream-parser.ts`, and `adapter.ts`:

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
- Add `streamingSpawnFn: StreamingSpawnFn | null` to `CodexAdapterOptions`.

### spawn.ts — new streaming spawn function

- Add `defaultStreamingSpawn: StreamingSpawnFn` that:
  - Spawns the child process (same options as `defaultSpawn`).
  - Wraps `child.stdout` with `node:readline.createInterface` for line-by-line output.
  - Returns `{ lines, waitForExit() }` where `lines` is an `AsyncIterable<string>` and `waitForExit()` returns `Promise<SpawnExitInfo>`.
  - Supports the same timeout mechanism (SIGTERM → SIGKILL after 5s grace).
  - `stderr` is buffered and available in `SpawnExitInfo` after exit.

### stream-parser.ts — incremental parser

- Add `parseCodexJsonIncremental(lines: AsyncIterable<string>): AsyncGenerator<StreamParseEvent>`:
  - Creates a `ParseState`.
  - Iterates lines. For each line, calls `processLine(line, state)`.
  - After each `processLine` call:
    - If `thread.started` set `state.sessionId`: yields `{ type: "meta", sessionId, model: "" }`.
    - If `item.completed` added new turns to `state.turns`: yields `{ type: "turn", turn }` for each new turn.
    - If `turn.completed` set `state.resultLine`: yields `{ type: "result", resultLine }`.
  - `item.started` events (status: "in_progress") do NOT yield any event.
  - `turn.started` events do NOT yield any event.
  - Non-JSON lines (e.g., "Reading additional input from stdin...") are silently skipped.
- The existing `parseCodexJson(stdout: string)` is unchanged.

### adapter.ts — send() rewrite

- Same pattern as the other adapters:
  - `createCodexAdapter` reads `options.streamingSpawnFn ?? defaultStreamingSpawn`.
  - `send()` acquires `withRefLock` for full streaming duration.
  - Starts streaming spawn, feeds lines into `parseCodexJsonIncremental()`.
  - For each turn event: rewrites index (highWater), appends to `turnsCache`, yields to consumer.
  - After iteration: awaits exit, yields `done` or `error`.
- `createSession()` continues using batch spawn + batch parser.

### Tests

- Test that turns are yielded BEFORE process exit (mock `StreamingSpawnFn` with delays, track `exited` flag).
- Test that `turnsCache` is updated mid-stream (`getTurns` returns partial results during iteration).
- Test that tool output events fill in `ToolCall.output` on already-yielded Turn objects.

## Then
- `createCodexAdapter()` returns an `Adapter` whose `send` yields turn events **incrementally as each turn is parsed from stdout** — the consumer receives turns before the codex process has exited.
- Each yielded turn has a globally monotonic index.
- Each yielded turn is appended to `turnsCache` immediately — `getTurns` returns all turns yielded so far, even mid-stream.
- After process exit, yields exactly one `{ type: "done", durationMs, tokens }`.
- On failure mid-stream: yields `{ type: "error", error }`. Already-yielded turns remain in cache.
- In the real Codex schema, tool output is inline in `item.completed` events (aggregated_output field) — no separate tool-output events exist. Each `item.completed` with `type: "command_execution"` produces a Turn with the output already populated.
- The `withRefLock` mechanism continues to serialize concurrent sends.
- `createSession` unchanged — uses batch spawn + batch parser.
- `parseCodexJsonIncremental` yields the same turns as `parseCodexJson` for identical input.
- Tests prove turns arrive before process exit.
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
