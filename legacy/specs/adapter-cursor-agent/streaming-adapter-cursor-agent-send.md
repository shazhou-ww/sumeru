---
scenario: "adapter-cursor-agent send() returns AsyncIterable<SendEvent> with incremental NDJSON parsing, yielding turn events as they are parsed from stdout"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, streaming, send, ndjson]
---

## Given
- `@sumeru/adapter-cursor-agent` currently implements `Adapter.send` returning `Promise<AgentResponse>`.
- The adapter spawns `cursor-agent -p <content> --resume <id> --print --output-format stream-json --trust --force --workspace <cwd>` and waits for exit, then parses full stdout via `parseStreamJson`.
- `stream-parser.ts` currently takes a complete stdout string and returns `CursorAgentParsedResult`.
- cursor-agent outputs NDJSON which can be parsed incrementally.
- The adapter caches turns in-memory (`turnsCache: Map<string, Turn[]>`).

## When
- The contributor rewrites `packages/adapter-cursor-agent/src/adapter.ts` and `packages/adapter-cursor-agent/src/stream-parser.ts`:
  - `stream-parser.ts` gains a new incremental parsing function that takes line-by-line stdout and returns an `AsyncIterable` of parsed events.
  - `createSession` accepts `SessionConfig`: `{ model: string | null; cwd: string | null }`. It spawns cursor-agent with a fixed `"ping"` prompt to acquire a session id. The `cwd` and `model` from `SessionConfig` are used when non-null.
  - `send(ref, content)` spawns cursor-agent and pipes stdout through the incremental parser. Yields `{ type: "turn", turn }` as each turn is parsed — without waiting for exit. Then yields `{ type: "done", durationMs, tokens }`.
  - On a **timeout** (`exitInfo.timedOut === true`, at `packages/adapter-cursor-agent/src/adapter.ts:332-337`), yields `{ type: "suspend", reason: "timeout", nativeId, elapsedMs: exitInfo.durationMs }` and `return`s — NOT an `error` event. `nativeId` is `ref.nativeId` (held since send entry); `elapsedMs` is the spawn's `exitInfo.durationMs`.
  - On any other failure (non-zero exit, unparseable output, stream/exit error), yields `{ type: "error", error }`.
  - Turns rewritten with globally monotonic indices. Each yielded turn appended to `turnsCache` immediately.
  - `AgentResponse`, `AdapterCapabilities` imports removed. `capabilities` field removed.
- The contributor runs `pnpm run build && pnpm run check && pnpm run test`.

## Then
- `createCursorAgentAdapter()` returns an `Adapter` whose `send` returns `AsyncIterable<SendEvent>`.
- `createSession` accepts `SessionConfig`. No `initialQuery` from config.
- On a successful `send`:
  - Yields `{ type: "turn", turn }` events incrementally as turns are parsed from NDJSON stdout.
  - Each turn has a globally monotonic index. Each turn is appended to `turnsCache` immediately.
  - After process exit, yields exactly one `{ type: "done", durationMs, tokens }`.
- On a **send timeout** (`exitInfo.timedOut === true`):
  - Yields exactly one `{ type: "suspend", reason: "timeout", nativeId, elapsedMs }` as the **last** event, then `return`s — NO `error`, NO `done`. `nativeId` is `ref.nativeId`; `elapsedMs` is `exitInfo.durationMs` (a number). The cursor-agent process is still SIGTERM→SIGKILLed by the spawn timer. Already-yielded turns remain in cache.
- On other failures:
  - Yields `{ type: "error", error: Error }` and terminates. Already-yielded turns remain in cache.
- The timeout unit test in `packages/adapter-cursor-agent/tests/send.test.ts` (formerly "yields error event on timeout") asserts `event.type === "suspend"` with `reason === "timeout"`, a non-empty `nativeId`, and numeric `elapsedMs`.
- `withRefLock` continues to serialize concurrent sends.
- No `capabilities` field on the returned adapter.
- Tests updated to consume `AsyncIterable<SendEvent>`.
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
- A `.changeset/<slug>.md` declares `@sumeru/adapter-cursor-agent` as a `major` bump.
