---
scenario: "createClaudeCodeAdapter().send() forwards a user message to an existing CC session via `claude -p <content> --resume <nativeId> --output-format stream-json --verbose --dangerously-skip-permissions --max-turns <n>`, parses the resulting NDJSON stream into Turn[] delta, appends them to the in-memory cache, and returns an AgentResponse — proving CC session resume works end-to-end"
feature: adapter-claude-code
tags: [adapter, claude-code, send, resume, turns, cli, stream-json, phase-3]
---

## Given
- `@sumeru/adapter-claude-code` is built and `claude` is available on `$PATH` (integration tests).
- An adapter-managed session exists: `const ref = await adapter.createSession({ model: "claude-sonnet-4-5", initialQuery: "Remember: the magic word is taro." })`.
- The in-memory turn cache (`Map<string, Turn[]>`) holds the initial Turn[] for `ref.nativeId`.
- For determinism, integration tests use a model that gives short, deterministic answers; unit tests inject a stubbed `spawnFn` that returns pre-canned NDJSON.

## When
- The test calls:
  ```typescript
  const r1 = await adapter.send(ref, "What is the magic word? Reply with just the word.");
  const r2 = await adapter.send(ref, "Echo it back twice, separated by a space.");
  ```
- Internally each call:
  1. Verifies the ref is not closed (closed → reject; see `adapter-claude-code-close.md`).
  2. Acquires a per-`nativeId` mutex so concurrent sends on the same ref are serialized.
  3. Records the **highest existing turn index** in the in-memory cache for `ref.nativeId` (or `-1` if cache is empty).
  4. Builds argv: `["-p", content, "--resume", ref.nativeId, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--max-turns", String(maxTurns)]`. If a model is configured (per-ref `meta.model` OR adapter-default), appends `["--model", model]`.
  5. Spawns the process via `spawnFn` with `cwd: ref.meta.cwd ?? process.cwd()`. Captures stdout/stderr.
  6. Awaits exit, with timeout (default 10 min, configurable via `sendTimeoutMs`).
  7. Calls `parseStreamJson(stdout)`. If `null`, throws (see "Unparseable" below).
  8. Computes `delta = parsed.turns` re-numbered to start at `highWater + 1` (CC starts every `--resume` run with a fresh per-run turn index — the adapter relabels indices to be globally monotonic across the whole Sumeru-side session).
  9. Appends `delta` to the in-memory cache.
  10. Returns the `AgentResponse` shape.

## Then
- **Resume works (the issue's first completion criterion)** — `r2.turns` (or `r1.turns`) contains an assistant turn whose `content` includes the substring `"taro"`. The model genuinely sees the prior session's `--resume` context. (Integration test gated on `SUMERU_CLAUDE_CODE_INTEGRATION=1`.)
- **Return shape** — Each `AgentResponse` has:
  - `turns: Turn[]` — the **new turns from this `send` call only**, not the entire history. Sorted by `index` ascending. `index` values are **globally monotonic** across the whole `nativeId` lifetime (the adapter rewrites the per-run indices CC produces).
  - `tokens: TokenUsage | null` — derived from `parsed.usage`: `{ input: usage.inputTokens, output: usage.outputTokens }`. CC reports last-turn-only token counts, not cumulative; this matches what the parser surfaces. `null` only if both `inputTokens` and `outputTokens` are `0` AND `parsed.subtype === "incomplete"` (i.e. CC never reported usage).
  - `durationMs: number` — wall-clock time from `spawn` to process exit, integer. NOT the `parsed.durationMs` from the result line (which is last-turn-only and not what callers want for "how long did this send take").
- **Turn shape per `@sumeru/core`** — Every emitted turn has:
  - `index: number` — the **adapter-rewritten global index** in the `nativeId`'s history (NOT the per-run index CC emitted).
  - `role: "user" | "assistant"` — adapter MUST emit at least one `role: "assistant"` turn for any successful send. The `role: "user"` turn for the prompt itself is emitted per the parser spec; if the parser doesn't emit it, the adapter prepends a synthesized `role: "user", content: <the prompt>, index: highWater + 1, timestamp: <ISO-8601>` so callers always see the user message in the history. (This is required because the server's `GET /messages` endpoint, specced in Phase 5, expects user messages to be in the history.)
  - `content: string` — text content; never `undefined`, never `null`. Empty string allowed (e.g. an assistant turn that was pure tool_use).
  - `timestamp: string` — ISO-8601 UTC. CC's stream-json does not embed per-line timestamps so the adapter records ingestion time.
  - `toolCalls: ToolCall[] | null` — non-empty array for assistant turns that used tools; `null` when no tool calls (NOT `[]`).
  - `tokens: TokenUsage | null` (or `undefined` if `@sumeru/core` still has the optional shape) — per-turn tokens are NOT reported by CC's stream-json; the parser leaves this `null`.
- **Tool-call passthrough** — A send whose response invokes a tool produces an assistant turn with `toolCalls.length > 0`. Each `ToolCall` has `tool: string`, `input: Record<string, unknown>`, `output: string | null` (populated from the matched `tool_result` user line, `null` if unmatched). `durationMs` and `exitCode` are `null` (CC does not surface these in stream-json).
- **No turn duplication across `send` calls** — `r1.turns` and `r2.turns` have no overlapping `index` values. Assert: `new Set([...r1.turns, ...r2.turns].map(t => t.index)).size === r1.turns.length + r2.turns.length`. The cache after both calls is the union of `before` + `r1.turns` + `r2.turns`, with strictly monotonic indices.
- **Cache append** — `getTurns(ref)` after `r1` returns the initial turns + `r1.turns`; after `r2` returns initial + `r1.turns` + `r2.turns`. Order preserved.
- **Concurrent send on the same ref** — Two parallel `send(ref, ...)` calls are **serialized inside the adapter** via a per-`nativeId` mutex. The second call awaits the first; the second's response sees the first's turns. Neither rejects with `409` (that's a Sumeru-server-layer concern, not adapter).
- **Send to closed session** — If `ref.nativeId` was previously closed via `adapter.close(ref)`, calling `send(ref, …)` rejects with `Error("claude code session <id> is closed")`. (Adapter tracks closed refs in an internal `Set<string>`.)
- **Send to never-created session** — If `ref.nativeId` is a syntactically valid string that does NOT exist in the adapter's cache, the adapter does NOT pre-flight check; it spawns `claude --resume <id>` and lets CC produce its own error. Typically CC exits non-zero with a "session not found"-like stderr; the adapter rejects with an `Error` whose message includes the id and the substring `"not found"` if recognized, else the generic `"claude exited with code <n>: <stderr-tail>"` shape.
- **Max turns mid-conversation** — If a send hits `--max-turns`, the adapter receives a stream ending with `result.subtype === "error_max_turns"`. The adapter:
  - Resolves the promise normally (NOT reject). The accumulated turns up to the cap are still returned in `turns`.
  - The `AgentResponse` carries `tokens` and `durationMs` populated from the partial run.
  - Records that the session "is at the cap" via a sticky flag the adapter exposes through `meta`. The next `send()` is still allowed to spawn `claude --resume <id>` — CC itself decides whether the resume can produce more turns. The adapter does NOT block subsequent sends. (Future work may add an explicit "session is exhausted" status; out of scope here.)
- **Unicode / multiline content** — Argv-passed; embedded quotes, backslashes, newlines, and emoji round-trip without corruption. Verified with `"line1\nline2\n中文 🍊 \"quoted\""`.
- **Timeout** — `send` honors a per-call timeout (default 2 h, configurable via `sendTimeoutMs`). On timeout (`exitInfo.timedOut === true`): the spawned `claude` is killed (`SIGTERM`, then `SIGKILL` 5 s later — the spawn timer is unchanged), and the iterable yields a terminal `{ type: "suspend", reason: "timeout", nativeId: ref.nativeId, elapsedMs: exitInfo.durationMs }` as its **last** event, then returns. It does NOT yield an `error` for a timeout. Turns produced before the timeout are NOT returned to the caller (the adapter does not partial-parse on timeout) but those already appended to the cache remain. The carried `nativeId` is the anchor a future `--resume` uses to continue (resume itself is RFC #95 Phase 2, out of scope here).
- **Non-zero exit AND parseable stream** — Adapter prefers parsed turns over exit code (matches createSession behavior; matches uwf "stdout truncation" pitfall). Resolves with `subtype: "incomplete"` reflected in the cache and a warning logged.
- **Non-zero exit AND unparseable** — Reject with `Error("claude exited with code <n>: <stderr-tail>")`. No turns appended to the cache.
- **Login / API key errors** — Same mapping as `createSession` (`"claude code is not logged in"` / `"claude code API key error"`). No turns appended.
- **Tests** under `packages/adapter-claude-code/tests/send.test.ts`:
  - Resume context test (`r2` sees `taro`) — gated on `SUMERU_CLAUDE_CODE_INTEGRATION=1`.
  - Default suite uses a stubbed `spawnFn` that fakes CC NDJSON output; verifies argv composition, mutex, closed-ref rejection, timeout→suspend, unicode argv handling, max-turns mid-conversation, cache append, monotonic-index rewrite.
  - The timeout test (`tests/send.test.ts`, formerly "yields error event on send timeout") asserts the iterable yields `event.type === "suspend"` with `event.reason === "timeout"`, a non-empty `event.nativeId`, and a numeric `event.elapsedMs` — NOT an `error` event. The matching assertion in `tests/options-from-config.test.ts` ("send timeout yields error event with the operator-configured value") is likewise updated to assert a `suspend` event (the operator's `sendTimeoutMs` no longer appears in an error message; assert `nativeId`/`elapsedMs` instead).
  - One unit test asserts that `r1.turns[0].index === <prevHigh + 1>` regardless of what per-run indices CC emits.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
