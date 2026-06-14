---
scenario: "createClaudeCodeAdapter().getTurns() returns the in-memory cached turn history for a Claude Code session — populated incrementally by createSession+send — as ordered @sumeru/core Turn[]"
feature: adapter-claude-code
tags: [adapter, claude-code, get-turns, cache, history, phase-3]
---

## Given
- `@sumeru/adapter-claude-code` is built. The adapter holds an in-memory `Map<string, Turn[]>` keyed by `nativeId`. The map is populated by:
  - `createSession` — appends the parsed initial Turn[] from the first `claude -p ...` invocation.
  - `send` — appends the parsed delta Turn[] (with adapter-rewritten globally monotonic indices) on each successful call.
- The adapter does NOT read from any filesystem location for session turns — Claude Code does not expose a stable, parseable session-turn store, so the in-memory cache is the **sole source of truth** for the lifetime of the adapter instance. (This is the key architectural difference from `adapter-hermes`, which reads from `~/.hermes/sessions/<id>.jsonl` or `~/.hermes/state.db`.)
- For the tests, the spawn boundary is replaced with a stubbed `spawnFn` that produces deterministic NDJSON fixtures, so the cached turns are predictable.

## When
- After at least one `createSession` (and optionally `send`) call, the test calls:
  ```typescript
  const turns = await adapter.getTurns(ref);
  ```
- The adapter:
  1. Validates `ref` via `assertRef`; rejects on malformed input.
  2. Looks up `ref.nativeId` in the in-memory cache.
  3. Returns a defensive copy (e.g. `[...cached]`) so callers cannot mutate the adapter's internal state.

## Then
- **Order** — `turns` is sorted by `index` ascending. The first turn has `index: 0` (the synthetic or parsed user turn from createSession), and indices are strictly monotonic across the entire history.
- **Length & roles** — A freshly-created session that has only had one `createSession({initialQuery: "hi"})` returns at least 2 turns: one `role: "user"` (`content: "hi"`) and at least one `role: "assistant"`. After two `send()` calls, the array contains all delta turns appended in order.
- **Tool calls round-trip** — Turns whose original CC stream contained `tool_use` segments produce `toolCalls: ToolCall[]` with `tool`, `input`, `output` populated (per `adapter-claude-code-stream-parser.md`); turns with no tool calls produce `toolCalls: null` (NOT `[]`).
- **Tokens** — Per-turn `tokens` is `null` (CC's stream-json does not surface per-turn tokens reliably). The aggregate per-`send` totals live in `AgentResponse.tokens`, NOT on individual turns.
- **Timestamps** — Each turn's `timestamp` is ISO-8601 UTC (`Z` suffix). Recorded at parse time by the adapter (CC stream-json has no per-line timestamps).
- **Empty / unknown session** — Calling `getTurns(ref)` on a `ref.nativeId` that the adapter has NEVER seen (no createSession was ever invoked through this adapter for this id) resolves to `[]` (empty array) — NOT an error. Rationale: `close` and `getTurns` should both be tolerant of missing cache entries — the absence is "I have nothing for that id", not "that id is corrupt".
- **Closed ref still readable** — After `close(ref)`, `getTurns(ref)` continues to return the cached turns unchanged. (See `adapter-claude-code-close.md`.)
- **Defensive copy** — Mutating the returned array (e.g. `(await adapter.getTurns(ref)).pop()`) does NOT affect the adapter's internal cache. A subsequent `getTurns(ref)` call returns the original full history.
- **No file I/O** — A unit test that monkey-patches `node:fs/promises` to throw on any call confirms `getTurns` does not touch the filesystem.
- **No process spawn** — A unit test that monkey-patches `spawnFn` to throw on call confirms `getTurns` does not spawn `claude`.
- **Concurrent reads** — Two parallel `getTurns(refA)` and `getTurns(refB)` calls succeed without locking each other (`Map.get` is synchronous).
- **Malformed ref** — `getTurns(null as unknown as NativeSessionRef)` / `getTurns(undefined as unknown as NativeSessionRef)` / `getTurns({} as NativeSessionRef)` (missing `nativeId`) reject with `Error("getTurns: invalid NativeSessionRef")` (mirrors close).
- **Adapter-instance scope** — A second `createClaudeCodeAdapter()` instance has its own empty cache. Calling `getTurns` on a ref produced by the first adapter through the second adapter returns `[]`. (This is the same scoping rule as the closed-ref Set.)
- **No cumulative-token aggregation here** — `getTurns` returns turns only. Aggregate token usage is computed by callers (or, for `send`, returned alongside in `AgentResponse.tokens`). The adapter does NOT keep a running `TokenUsage` per session. Rationale: CC reports last-turn-only tokens — any "cumulative" number we'd compute would be inaccurate; better to surface only what's authoritative.
- **Tests** under `packages/adapter-claude-code/tests/get-turns.test.ts`:
  - After createSession with stubbed init NDJSON, `getTurns` returns the parsed initial Turn[] in order.
  - After createSession + 2 sends, `getTurns` returns the union (initial + delta1 + delta2) with strictly monotonic indices.
  - Defensive-copy test: mutating the returned array does not affect a subsequent `getTurns` result.
  - Returns `[]` for an unknown `nativeId`.
  - Rejects on malformed ref.
  - Returns the same turns after `close(ref)`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
