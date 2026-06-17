---
scenario: "createCursorAgentAdapter().getTurns() returns a defensive copy of the in-memory turn cache for a given session, never mutating the adapter's internal state"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, get-turns, turn-cache]
---

## Given
- `@sumeru/adapter-cursor-agent` is built. A session has been created via `createSession`, and optionally one or more `send` calls have been made.
- The adapter maintains an in-memory `Map<string, Turn[]>` keyed by `nativeId`. This is the sole authority on session history for the adapter's lifetime.

## When
- Test code calls:
  ```typescript
  const turns = await adapter.getTurns(ref);
  ```

## Then
- **Happy path** — Returns a `Turn[]` containing all turns from `createSession` plus all subsequent `send` calls, in index order (monotonically increasing from 0).
- **Defensive copy** — The returned array is a shallow copy. Mutating the returned array (push, pop, splice) does NOT affect the adapter's internal cache. A subsequent `getTurns(ref)` returns the original unmodified data.
- **After createSession only** — Returns at least one turn (the initial assistant response, possibly preceded by a user turn).
- **After multiple sends** — Returns the accumulated history across all calls.
- **Unknown nativeId** — `getTurns({ nativeId: "nonexistent-id", meta: {} })` returns `[]` (empty array, NOT null, NOT a rejection).
- **After close** — `getTurns(ref)` still works on a closed session (close does not evict the cache).
- **Invalid ref** — `getTurns(null)`, `getTurns(undefined)`, `getTurns({nativeId: ""})` reject with `Error("getTurns: invalid NativeSessionRef")`.
- **Per-instance isolation** — Two adapter instances have independent caches. `getTurns` on one never sees the other's sessions.
- **Tests** under `packages/adapter-cursor-agent/tests/get-turns.test.ts`:
  - Returns turns after createSession.
  - Returns accumulated turns after multiple sends.
  - Defensive copy test (mutate returned array, verify internal state unchanged).
  - Unknown nativeId returns empty array.
  - Works after close.
  - Invalid ref rejects.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
