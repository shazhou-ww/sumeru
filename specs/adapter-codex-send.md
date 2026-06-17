---
scenario: "createCodexAdapter().send spawns `codex exec resume <id> [PROMPT] --json` and returns the delta turns with globally monotonic indices"
feature: adapter-codex
tags: [adapter, codex, openai, send, resume]
---

## Given
- `@sumeru/adapter-codex` is built.
- A session has been created via `createSession`, returning a `NativeSessionRef` with a valid `nativeId`.
- The turns cache contains the initial turns from `createSession` (indices 0..N-1).
- The session has NOT been closed.

## When
- The consumer calls:
  ```typescript
  const response = await adapter.send(ref, "Create a file test.txt with 'Hello'");
  ```

## Then
- The adapter spawns:
  ```
  codex exec resume <nativeId> "Create a file test.txt with 'Hello'" --json --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -C <cwd-from-ref.meta> -m <model-from-ref.meta>
  ```
  Key difference from `createSession`: the `resume <nativeId>` subcommand carries forward the conversation context.
- The adapter parses the JSONL output into turns.
- **Index rewriting**: Codex produces per-run indices starting at 0. The adapter rewrites them to be globally monotonic:
  - Compute `highWater = max(index) of cached turns` (or `-1` if empty).
  - Rewrite each new turn's index to `highWater + 1 + offset`.
- Append the delta turns to the in-memory cache.
- Return an `AgentResponse`:
  ```typescript
  {
    turns: Turn[],           // the delta turns (newly produced, with rewritten indices)
    tokens: TokenUsage | null,  // { input, output } if JSONL reports usage, else null
    durationMs: number       // wall-clock duration of the spawn
  }
  ```
- If the process times out (exceeds `sendTimeoutMs`), throw:
  ```
  send timed out after 1800000ms
  ```
- If the session was closed (via `adapter.close(ref)`), throw immediately without spawning:
  ```
  codex session <nativeId> is closed
  ```

## Concurrency (send mutex)
- Multiple concurrent `send` calls on the same `nativeId` are serialized via a per-session promise-chain lock (same pattern as adapter-claude-code).
- This prevents race conditions on the in-memory turns cache.
- Different `nativeId`s can `send` concurrently.

## Error cases
- **Session not found** — If Codex reports the session ID is invalid/expired, throw:
  ```
  codex session <nativeId> not found: <detail from stderr>
  ```
- **Empty content** — If `content` is empty or not a string, throw:
  ```
  send: content must be a non-empty string
  ```
- **Invalid ref** — If `ref` is null/undefined or has no `nativeId`, throw:
  ```
  send: invalid NativeSessionRef
  ```

## Tests
- Unit test with mock `spawnFn` returning a resume fixture → asserts:
  - `response.turns` has rewritten indices starting at `N` (where `N` is the cached turn count).
  - `getTurns(ref)` returns the full history (initial + delta).
- Unit test verifying send mutex: two concurrent sends return sequentially, indices remain monotonic.
- Unit test with mock returning timeout → asserts timeout error.
- Unit test calling send after close → asserts "session is closed" error.
