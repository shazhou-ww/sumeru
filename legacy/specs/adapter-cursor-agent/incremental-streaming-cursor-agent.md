---
scenario: "adapter-cursor-agent implements true incremental streaming: streaming spawn, incremental NDJSON parser, and send() that yields turns before process exit"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, streaming, incremental, ndjson, spawn]
---

## Given
- `@sumeru/adapter-cursor-agent` send() currently collects all stdout after process exit, batch-parses via `parseStreamJson(result.stdout)`, then yields all turns at once — fake streaming.
- `defaultSpawn` in `spawn.ts` returns `Promise<SpawnResult>` where `SpawnResult.stdout` is a complete string available only after the child process exits.
- `parseStreamJson` in `stream-parser.ts` takes a full `stdout: string`, splits into lines, iterates synchronously via `processLine()`, and returns `CursorAgentParsedResult | null`.
- Internal functions `processLine()`, `processSystemLine()`, `processAssistantLine()`, `processUserLine()`, `processToolCall()`, `processToolCallStarted()`, `processToolCallCompleted()` already process lines individually — they just aren't exposed as an incremental interface.
- cursor-agent emits NDJSON lines: `system` (session_id, model, cwd), `user` (text message), `thinking` (discarded), `assistant` (text content), `tool_call` (started/completed subtypes with call_id), `result` (usage, duration).
- Tool calls in cursor-agent use separate `tool_call` events with `started` and `completed` subtypes and a `call_id` for correlation — unlike Claude Code where tool_use is embedded in assistant content.
- `types.ts` defines `SpawnFn`, `SpawnArgs`, `SpawnResult`, `CursorAgentAdapterOptions`.
- `turnsCache: Map<string, Turn[]>` is only updated after process exit.

## When
The contributor modifies `packages/adapter-cursor-agent/src/types.ts`, `spawn.ts`, `stream-parser.ts`, and `adapter.ts`:

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
- Add `streamingSpawnFn: StreamingSpawnFn | null` to `CursorAgentAdapterOptions`.

### spawn.ts — new streaming spawn function

- Add `defaultStreamingSpawn: StreamingSpawnFn` that:
  - Spawns the child process (same options as `defaultSpawn`).
  - Wraps `child.stdout` with `node:readline.createInterface` for line-by-line output.
  - Returns `{ lines, waitForExit() }` where `lines` is an `AsyncIterable<string>` and `waitForExit()` returns `Promise<SpawnExitInfo>`.
  - Supports the same timeout mechanism (SIGTERM → SIGKILL after 5s grace).
  - `stderr` is buffered and available in `SpawnExitInfo` after exit.

### stream-parser.ts — incremental parser

- Add `parseStreamJsonIncremental(lines: AsyncIterable<string>): AsyncGenerator<StreamParseEvent>`:
  - Creates a `ParseState`.
  - Iterates lines. For each line, calls `processLine(line, state)`.
  - After each `processLine` call:
    - If new turns were added to `state.turns`: yields `{ type: "turn", turn }` for each new turn.
    - If `state.sessionId` was just set (first `system` line): yields `{ type: "meta", sessionId, model }`.
    - If `state.resultLine` was just set: yields `{ type: "result", resultLine }`.
  - Tool call `started` events create/extend assistant turns; tool call `completed` events fill in output on existing `ToolCall` objects.
  - Behavior difference from Claude Code: a `tool_call` (subtype: `started`) may CREATE a new assistant turn (if no assistant turn exists yet) or MUTATE the last assistant turn's `toolCalls` array. The incremental parser must detect both:
    - If a new turn was created (state.turns grew): yield it.
    - If an existing turn was mutated (toolCalls grew): the turn was already yielded — NO new event. The consumer holds a reference to the same Turn object.
  - `tool_call` (subtype: `completed`) fills in `ToolCall.output` on an already-yielded Turn via the shared `pendingToolCalls` reference — no new event.
- The existing `parseStreamJson(stdout: string)` is unchanged.

### adapter.ts — send() rewrite

- Same pattern as adapter-claude-code:
  - `createCursorAgentAdapter` reads `options.streamingSpawnFn ?? defaultStreamingSpawn`.
  - `send()` acquires `withRefLock` for full streaming duration.
  - Starts streaming spawn, feeds lines into `parseStreamJsonIncremental()`.
  - For each turn event: rewrites index (highWater), appends to `turnsCache`, yields to consumer.
  - After iteration: awaits exit, yields `done` or `error`.
- `createSession()` continues using batch spawn + batch parser.

### Tests

- Test that turns are yielded BEFORE process exit (mock `StreamingSpawnFn` with delays, track `exited` flag).
- Test that `turnsCache` is updated mid-stream (`getTurns` returns partial results during iteration).
- Test that tool_call `completed` events fill in output on already-yielded Turn objects (verify the Turn object in cache has `ToolCall.output` populated after the `completed` line arrives).

## Then
- `createCursorAgentAdapter()` returns an `Adapter` whose `send` yields turn events **incrementally as each turn is parsed from stdout** — the consumer receives turns before the cursor-agent process has exited.
- Each yielded turn has a globally monotonic index.
- Each yielded turn is appended to `turnsCache` immediately — `getTurns` returns all turns yielded so far, even mid-stream.
- After process exit, yields exactly one `{ type: "done", durationMs, tokens }`.
- On failure mid-stream: yields `{ type: "error", error }`. Already-yielded turns remain in cache.
- Tool call `started` events that create new turns produce immediate yields; `started` events that mutate existing turns and `completed` events do NOT yield new events (reference sharing).
- The `withRefLock` mechanism continues to serialize concurrent sends.
- `createSession` unchanged — uses batch spawn + batch parser.
- `parseStreamJsonIncremental` yields the same turns as `parseStreamJson` for identical input.
- Tests prove turns arrive before process exit.
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
