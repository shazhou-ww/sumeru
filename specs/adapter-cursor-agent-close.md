---
scenario: "createCursorAgentAdapter().close() logically closes a session by adding its nativeId to a per-instance closed-refs Set, blocking further send() calls without any cursor-agent-side notification or cache eviction"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, close, session-lifecycle]
---

## Given
- `@sumeru/adapter-cursor-agent` is built. A session has been created via `createSession`, yielding a `NativeSessionRef` with a valid `nativeId`.
- cursor-agent does NOT have a "close session" CLI command — sessions are ephemeral from the CLI's perspective. The adapter's `close` is purely a local bookkeeping operation.

## When
- Test code calls:
  ```typescript
  await adapter.close(ref);
  ```

## Then
- `close(ref)` resolves to `void` (no return value, no thrown error on a valid ref).
- After `close(ref)`, calling `adapter.send(ref, "anything")` rejects with `Error("cursor-agent session <nativeId> is closed")`.
- After `close(ref)`, calling `adapter.getTurns(ref)` still succeeds and returns the cached turns (close does NOT evict the turn cache — the turns remain readable for history purposes).
- **Double close** — calling `close(ref)` a second time does NOT throw. It is idempotent.
- **Invalid ref** — `close(null)`, `close(undefined)`, `close({nativeId: ""})` all reject with `Error("close: invalid NativeSessionRef")`.
- **Scope** — The closed-refs Set is per adapter instance. A different adapter instance is unaffected.
- **No side-effects** — `close` does NOT spawn any process, does NOT make any network call, does NOT write to disk.
- **Tests** under `packages/adapter-cursor-agent/tests/close.test.ts`:
  - close resolves void on valid ref.
  - send after close rejects.
  - getTurns after close still works.
  - double close is idempotent.
  - invalid ref rejects.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
