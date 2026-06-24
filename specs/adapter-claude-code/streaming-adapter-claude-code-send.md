---
scenario: "adapter-claude-code send() returns AsyncIterable<SendEvent> with incremental NDJSON parsing, yielding turn events as they are parsed from stdout"
feature: adapter-claude-code
tags: [adapter, claude-code, streaming, send, ndjson]
---

## Given
- `@sumeru/adapter-claude-code` currently implements `Adapter.send` returning `Promise<AgentResponse>`.
- The adapter spawns `claude -p <content> --resume <id> --output-format stream-json --verbose --dangerously-skip-permissions --max-turns <n>` and waits for exit, then parses the full stdout via `parseStreamJson`.
- `stream-parser.ts` currently takes a complete stdout string and returns `ClaudeCodeParsedResult`.
- Claude Code outputs NDJSON (one JSON object per line) which can be parsed incrementally.
- The adapter caches turns in-memory (`turnsCache: Map<string, Turn[]>`).

## When
- The contributor rewrites `packages/adapter-claude-code/src/adapter.ts` and `packages/adapter-claude-code/src/stream-parser.ts`:
  - `stream-parser.ts` gains a new incremental parsing function (e.g. `parseStreamJsonIncremental`) that takes a `ReadableStream` or `AsyncIterable<string>` (line-by-line from the child process stdout) and returns an `AsyncIterable` of parsed events (turns, session-id, result metadata).
  - `createSession` accepts `SessionConfig`: `{ model: string | null; cwd: string | null }`. It spawns `claude -p "ping" ...` to acquire a session id — no user-supplied initial query. The `cwd` and `model` from `SessionConfig` are used when non-null.
  - `send(ref, content)` spawns the claude CLI and pipes stdout through the incremental parser. As each complete assistant turn is parsed from the NDJSON stream, the adapter yields `{ type: "turn", turn }` immediately — without waiting for the process to exit. After the process exits, yields `{ type: "done", durationMs, tokens }`.
  - On a **timeout** (`exitInfo.timedOut === true`, at `packages/adapter-claude-code/src/adapter.ts:343-348`), yields `{ type: "suspend", reason: "timeout", nativeId, elapsedMs: exitInfo.durationMs }` and `return`s — NOT an `error` event. `nativeId` is the `streamSend(nativeId, …)` parameter already in scope; `elapsedMs` is the spawn's wall-clock `exitInfo.durationMs`.
  - On any other failure (non-zero exit, unparseable output, stream-read/exit error), yields `{ type: "error", error }` and terminates.
  - Turns are rewritten with globally monotonic indices as before (highWater mechanism).
  - Each yielded turn is also appended to `turnsCache` immediately (so `getTurns` is up-to-date mid-stream).
  - `AgentResponse`, `AdapterCapabilities` imports removed. `capabilities` field removed.
- The contributor runs `pnpm run build && pnpm run check && pnpm run test`.

## Then
- `createClaudeCodeAdapter()` returns an `Adapter` whose `send` returns `AsyncIterable<SendEvent>`.
- `createSession` accepts `SessionConfig`. No `initialQuery` from config. Uses fixed `"ping"` prompt internally.
- On a successful `send`:
  - The iterable yields `{ type: "turn", turn }` events **incrementally** as each turn is parsed from the NDJSON stdout — the consumer receives turns before the claude process has exited.
  - Each yielded turn has a globally monotonic index (continuing from the session's highWater).
  - Each yielded turn is appended to `turnsCache` immediately — `getTurns` returns all turns yielded so far, even mid-stream.
  - After the process exits, yields exactly one `{ type: "done", durationMs, tokens }`.
- On a **send timeout** (the spawn timer fires; `exitInfo.timedOut === true`):
  - Yields exactly one `{ type: "suspend", reason: "timeout", nativeId, elapsedMs }` as the **last** event, then `return`s — NO `error` and NO `done` follow.
  - `nativeId` equals `ref.nativeId` (the resume anchor the next `--resume` will use); `elapsedMs` is `exitInfo.durationMs` (a number).
  - The spawned `claude` process is still SIGTERM→SIGKILLed by the spawn timer (suspend records the checkpoint; it does NOT freeze or keep the process). Turns produced before the timeout remain in `turnsCache`.
- On other failures mid-stream (non-zero exit, unparseable output, stream/exit error):
  - Yields `{ type: "error", error: Error }` and terminates. Turns yielded before the error remain in the cache.
- The `withRefLock` mechanism continues to serialize concurrent sends.
- No `capabilities` field on the returned adapter.
- Tests in `packages/adapter-claude-code/tests/` are updated to consume `AsyncIterable<SendEvent>`.
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
- A `.changeset/<slug>.md` declares `@sumeru/adapter-claude-code` as a `major` bump.
