---
scenario: "adapter-codex send() returns AsyncIterable<SendEvent> with incremental JSONL parsing, yielding turn events as they are parsed from stdout"
feature: adapter-codex
tags: [adapter, codex, streaming, send, jsonl]
---

## Given
- `@sumeru/adapter-codex` currently implements `Adapter.send` returning `Promise<AgentResponse>`.
- The adapter spawns `codex exec resume <id> <prompt> --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C <cwd>` and waits for exit, then parses full stdout via `parseCodexJson`.
- `stream-parser.ts` currently takes a complete stdout string and returns `CodexParsedResult`.
- Codex outputs JSONL (one JSON object per line) which can be parsed incrementally.
- The adapter caches turns in-memory (`turnsCache: Map<string, Turn[]>`).

## When
- The contributor rewrites `packages/adapter-codex/src/adapter.ts` and `packages/adapter-codex/src/stream-parser.ts`:
  - `stream-parser.ts` gains a new incremental parsing function that takes line-by-line stdout and returns an `AsyncIterable` of parsed events.
  - `createSession` accepts `SessionConfig`: `{ model: string | null; cwd: string | null }`. It spawns codex with a fixed `"ping"` prompt to acquire a session id. The `cwd` and `model` from `SessionConfig` are used when non-null.
  - `send(ref, content)` spawns codex and pipes stdout through the incremental parser. Yields `{ type: "turn", turn }` as each turn is parsed. Then yields `{ type: "done", durationMs, tokens }`.
  - On failure, yields `{ type: "error", error }`.
  - Turns rewritten with globally monotonic indices. Each yielded turn appended to `turnsCache` immediately.
  - `AgentResponse`, `AdapterCapabilities` imports removed. `capabilities` field removed.
- The contributor runs `pnpm run build && pnpm run check && pnpm run test`.

## Then
- `createCodexAdapter()` returns an `Adapter` whose `send` returns `AsyncIterable<SendEvent>`.
- `createSession` accepts `SessionConfig`. No `initialQuery` from config.
- On a successful `send`:
  - Yields `{ type: "turn", turn }` events incrementally as turns are parsed from JSONL stdout.
  - Each turn has a globally monotonic index. Each turn is appended to `turnsCache` immediately.
  - After process exit, yields exactly one `{ type: "done", durationMs, tokens }`.
- On failure:
  - Yields `{ type: "error", error: Error }` and terminates. Already-yielded turns remain in cache.
- `withRefLock` continues to serialize concurrent sends.
- No `capabilities` field on the returned adapter.
- Tests updated to consume `AsyncIterable<SendEvent>`.
- `pnpm run build` exits 0, `pnpm run check` exits 0, `pnpm run test` exits 0.
- A `.changeset/<slug>.md` declares `@sumeru/adapter-codex` as a `major` bump.
