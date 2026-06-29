---
scenario: "createClaudeCodeAdapter().close() marks a NativeSessionRef as closed in the adapter's internal registry; subsequent send rejects, getTurns still returns the cached history, close is idempotent"
feature: adapter-claude-code
tags: [adapter, claude-code, close, registry, phase-3]
---

## Given
- `@sumeru/adapter-claude-code` is built and an adapter instance is held: `const adapter = createClaudeCodeAdapter();`.
- A session has been created and is held as `const ref = await adapter.createSession({});`.
- The adapter's in-memory turn cache (`Map<string, Turn[]>`) holds turns for `ref.nativeId`.
- Claude Code itself has **no concept of "closed" sessions** at the CLI level — every `claude --resume <id>` invocation just attempts to continue the session. The adapter's `close` is therefore a **logical close** (ref is dead from this adapter's perspective), NOT a physical delete or any kind of CC-side notification.

## When
- The test calls:
  ```typescript
  await adapter.close(ref);
  ```
- Internally the adapter:
  1. Validates the ref shape (`assertRef`); rejects on malformed inputs.
  2. Inserts `ref.nativeId` into a `Set<string>` of closed refs held in adapter-instance closure state.
  3. Resolves with `void`.
  4. Does NOT spawn any `claude` process. Does NOT delete the cached turns. Does NOT touch the filesystem.

## Then
- **Idempotency** — Calling `close(ref)` a second time is a no-op success (resolves with `void`, no error). The `Set` insertion is naturally idempotent.
- **Closed ref behavior across other adapter methods**:
  - `send(ref, "anything")` after close → rejects with `Error("claude code session <id> is closed")` (matches `adapter-claude-code-send.md`'s closed-ref contract).
  - `getTurns(ref)` after close → **still works** and returns the cached turns. Closed in the adapter is a "no more writes from this adapter" flag, not a "history is gone" flag. (Matches `architecture.md`'s "关闭后消息历史仍可读取" expectation.)
  - `close(ref)` after close → resolves (idempotent, see above).
- **No cache mutation** — A test that snapshots the cached `Turn[]` for the session before and after `close` asserts the array is **byte-identical** (same length, same element references) — the adapter does NOT clear the turn cache on close. Cache eviction is a separate concern (out of scope here).
- **No process spawn** — A unit test that monkey-patches `spawnFn` to throw if invoked confirms `close` does NOT spawn anything.
- **Registry scope** — The closed-ref `Set` is **per adapter instance**. A new adapter created via `createClaudeCodeAdapter()` after `close` will NOT consider the ref closed. (Rationale: `close` reflects intent of *this* adapter session, not durable state. Persistence is the server layer's responsibility.)
- **Memory bounds** — The closed-ref `Set` does NOT grow unbounded across the adapter's lifetime in a meaningful way for MVP — production usage tops out at low thousands of sessions per process. The adapter does NOT add LRU eviction in Phase 3; if it ever does, the eviction policy lands in a follow-up spec.
- **Error inputs** — `close(null as unknown as NativeSessionRef)` / `close(undefined as unknown as NativeSessionRef)` / `close({} as NativeSessionRef)` (missing `nativeId`) reject with `Error("close: invalid NativeSessionRef")`. (Defensive — matches the spirit of strict TypeScript inputs and mirrors `adapter-hermes-close.md`.)
- **Concurrent close + send** — If `close(ref)` is awaited while a `send(ref, …)` is in flight: the in-flight `send` is permitted to complete (it acquired the per-ref mutex first), and only the **next** `send(ref, …)` rejects with the closed error. The adapter does NOT abort the in-flight `claude` process on close. (Aborting is a future enhancement; spec'd here as out-of-scope.)
- **Tests** under `packages/adapter-claude-code/tests/close.test.ts`:
  - Close → `send` rejects with `"claude code session <id> is closed"`.
  - Close → `getTurns` still returns turns from the in-memory cache.
  - Close is idempotent.
  - Close does NOT spawn `claude`.
  - Close + concurrent in-flight send: in-flight send completes; next send rejects.
  - Close with malformed input rejects with `"close: invalid NativeSessionRef"`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
