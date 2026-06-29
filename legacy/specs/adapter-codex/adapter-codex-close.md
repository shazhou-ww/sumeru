---
scenario: "createCodexAdapter().close marks a session as closed, causing subsequent send calls to reject immediately"
feature: adapter-codex
tags: [adapter, codex, openai, close]
---

## Given
- `@sumeru/adapter-codex` is built.
- A session has been created via `createSession`, returning a `NativeSessionRef` with a valid `nativeId`.
- The session has at least one turn cached in-memory.

## When
- The consumer calls:
  ```typescript
  await adapter.close(ref);
  ```

## Then
- The adapter adds `nativeId` to an internal `Set<string>` of closed sessions.
- The call resolves with `void` (no return value).
- **No external side effects** — unlike some adapters, Codex has no explicit session termination API; `close` is a logical close only.
- The in-memory turns cache is NOT evicted — `getTurns(ref)` still returns the cached history after close.

## After close
- Subsequent `send(ref, content)` calls throw immediately **without spawning**:
  ```
  codex session <nativeId> is closed
  ```
- `getTurns(ref)` continues to work — returns the cached history.
- Calling `close(ref)` again is a no-op (idempotent) — no error is thrown.

## Error cases
- **Invalid ref** — If `ref` is null/undefined or has no `nativeId`, throw:
  ```
  close: invalid NativeSessionRef
  ```

## Tests
- Unit test: `close(ref)` resolves without error.
- Unit test: `send(ref, content)` after `close(ref)` throws "session is closed".
- Unit test: `getTurns(ref)` after `close(ref)` returns the cached history.
- Unit test: `close(ref)` twice does not throw.
- Unit test: `close({ nativeId: "" })` throws "invalid NativeSessionRef".
