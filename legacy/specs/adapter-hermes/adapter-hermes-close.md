---
scenario: "createHermesAdapter().close() marks a NativeSessionRef as closed in the adapter's internal registry; subsequent send/getTurns behave per their own contracts"
feature: adapter-hermes
tags: [adapter, hermes, close, registry, phase-3]
---

## Given
- `@sumeru/adapter-hermes` is built and an adapter instance is held: `const adapter = createHermesAdapter();`.
- A session has been created and is held as `const ref = await adapter.createSession({});`.
- Hermes itself has **no concept of "closed" sessions** at the CLI level — sessions live in the DB indefinitely until explicitly deleted via `hermes sessions delete`. The adapter's `close` is therefore a **logical close** (ref is dead from the adapter's perspective), NOT a physical delete.

## When
- The test calls:
  ```typescript
  await adapter.close(ref);
  ```
- Internally the adapter:
  1. Inserts `ref.nativeId` into a `Set<string>` of closed refs held in adapter-instance closure state.
  2. Resolves with `void`.
  3. Does NOT spawn any `hermes` process. Does NOT delete any DB row. Does NOT touch the filesystem.

## Then
- **Idempotency** — Calling `close(ref)` a second time is a no-op success (resolves with `void`, no error). The `Set` insertion is naturally idempotent.
- **Closed ref behavior across other adapter methods**:
  - `send(ref, "anything")` after close → rejects with `Error("hermes session <id> is closed")` (matches `adapter-hermes-send.md`'s closed-ref contract).
  - `getTurns(ref)` after close → **still works** and returns the turns from the DB. Closed in the adapter is a "no more writes from this adapter" flag, not a "history is gone" flag. (Matches the issue's "关闭后消息历史仍可读取" expectation reflected in the architecture spec.)
  - `close(ref)` after close → resolves (idempotent, see above).
- **No DB mutation** — A test that snapshots the row count of `messages` for the session before and after `close` asserts the count is **unchanged**. (Verified against the fixture DB in unit tests.)
- **No process spawn** — A unit test that monkey-patches `child_process.spawn` to throw if invoked confirms `close` does NOT spawn anything.
- **Registry scope** — The closed-ref `Set` is **per adapter instance**. A new adapter created via `createHermesAdapter()` after `close` will NOT consider the ref closed. (Rationale: `close` reflects intent of *this* adapter session, not durable state. Persistence is the server layer's responsibility.)
- **Memory bounds** — The closed-ref `Set` does NOT grow unbounded across the adapter's lifetime in a meaningful way for MVP — production usage tops out at low thousands of sessions per process. The adapter does NOT add LRU eviction in Phase 3; if it ever does, the eviction policy lands in a follow-up spec.
- **Error inputs** — `close(null)` / `close(undefined)` / `close({})` (missing `nativeId`) reject with `Error("close: invalid NativeSessionRef")`. (Defensive — matches the spirit of strict TypeScript inputs.)
- **Concurrent close + send** — If `close(ref)` is awaited while a `send(ref, …)` is in flight: the in-flight `send` is permitted to complete (it acquired the per-ref mutex first), and only the **next** `send(ref, …)` rejects with the closed error. The adapter does NOT abort the in-flight Hermes process on close. (Aborting is a future enhancement; spec'd here as out-of-scope.)
- **Tests** under `packages/adapter-hermes/tests/close.test.ts`:
  - Close → `send` rejects.
  - Close → `getTurns` still returns turns (using the fixture DB).
  - Close is idempotent.
  - Close does not spawn `hermes`.
  - Close + concurrent in-flight send: in-flight send completes; next send rejects.
  - Close with malformed input rejects.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
