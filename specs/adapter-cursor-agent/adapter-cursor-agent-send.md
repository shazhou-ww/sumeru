---
scenario: "createCursorAgentAdapter().send() resumes an existing cursor-agent session by spawning `cursor-agent -p <content> --print --output-format stream-json --trust --force --resume <nativeId> --workspace <cwd>`, parses the new turns, rewrites indices to be globally monotonic, and appends to the in-memory turn cache"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, send, resume, cli, stream-json]
---

## Given
- `@sumeru/adapter-cursor-agent` is built. A session has been created via `createSession`, yielding a `NativeSessionRef` with a valid `nativeId` (the cursor-agent session UUID).
- The adapter's in-memory turn cache already contains the turns from `createSession`.
- cursor-agent supports `--resume <chatId>` to resume a prior chat by session id. When resumed, it only returns new turn events (not the full history). This is confirmed by the spike.

## When
- Test code calls:
  ```typescript
  const response = await adapter.send(ref, "What files did you create?");
  ```
- Internally, the adapter:
  1. Validates that `ref` is a non-null `NativeSessionRef` with a non-empty `nativeId`.
  2. Validates that `ref.nativeId` is not in the closed-refs set.
  3. Validates that `content` is a non-empty string.
  4. Acquires a per-nativeId mutex (send serialization — mirrors adapter-claude-code).
  5. Records the high-water turn index from the existing cache.
  6. Builds argv: `["-p", content, "--print", "--output-format", "stream-json", "--trust", "--force", "--resume", ref.nativeId, "--workspace", cwd]`. Appends model if set.
  7. Spawns via `spawnFn` with the same cwd as stored in `ref.meta.cwd`.
  8. Awaits process exit.
  9. Calls `parseStreamJson(stdout)`.
  10. Rewrites the parsed turns' indices to be globally monotonic (starting from highWater + 1).
  11. Appends the new turns to the existing cache entry.
  12. Derives `TokenUsage` from the parsed result's `usage` field.
  13. Returns `AgentResponse { turns: <new turns only>, tokens: <usage or null>, durationMs: <wall-clock> }`.

## Then
- **Happy path** — `AgentResponse` has:
  - `turns` containing at least one new Turn (the assistant's response). Each turn's `index` is greater than any index from the prior `createSession` or `send` calls.
  - `tokens` is `{ input: <n>, output: <n> }` derived from the result event's `usage.inputTokens` / `usage.outputTokens`. If no result line, tokens is `null`.
  - `durationMs` is a positive integer (wall-clock time of the spawn).
- **Index monotonicity** — After send, calling `getTurns(ref)` returns all turns (from create + send) with strictly monotonically increasing indices starting at 0.
- **Multiple sends** — Three sequential `send` calls accumulate turns correctly. The turn cache grows with each call, indices never overlap.
- **Mutex serialization** — Two concurrent `send` calls on the same `ref` are serialized (not interleaved). The second waits for the first to complete before spawning. This prevents index conflicts and race conditions in the turn cache.
- **Different refs** — `send` on two different refs runs concurrently (no global lock, only per-nativeId).
- **Closed ref** — `send` on a closed ref rejects with `Error("cursor-agent session <nativeId> is closed")`.
- **Invalid ref** — `send(null, "...")`, `send({nativeId: ""}, "...")` reject with `Error("send: invalid NativeSessionRef")`.
- **Empty content** — `send(ref, "")` rejects with `Error("send: content must be a non-empty string")`.
- **Timeout** — `send` honors default 10 min timeout. On timeout: process killed; promise rejects with `Error("send timed out after <ms>ms")`.
- **Unparseable output** — If `parseStreamJson(stdout)` returns `null`, rejects with an Error including stdout head and stderr tail.
- **Session not found** — If stderr contains `/not found|no such session|session.*not.*exist/i`, rejects with `Error("cursor-agent session <nativeId> not found: <stderr tail>")`.
- **Argv includes --resume** — The `--resume` flag carries the exact `ref.nativeId` string.
- **Tests** under `packages/adapter-cursor-agent/tests/send.test.ts`:
  - Mocked `spawnFn` suite covering: happy path, multiple sends, concurrency serialization, closed-ref rejection, invalid-ref rejection, empty-content rejection, timeout, unparseable, session-not-found.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
