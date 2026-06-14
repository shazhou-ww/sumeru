---
scenario: "stream-parser.ts parses Claude Code's `--output-format stream-json --verbose` NDJSON output into ordered Turn[] plus a result summary, with a graceful incomplete-stream fallback"
feature: adapter-claude-code
tags: [adapter, claude-code, parser, stream-json, ndjson, turns, phase-3]
---

## Given
- `@sumeru/adapter-claude-code` is built. The parser lives at `packages/adapter-claude-code/src/stream-parser.ts` and exports a single named function `parseStreamJson(stdout: string): ClaudeCodeParsedResult | null` plus the type `ClaudeCodeParsedResult` (locally defined in the package's `types.ts`).
- The reference parser is at `~/repos/united-workforce/packages/agent-claude-code/src/session-detail.ts` (function `parseClaudeCodeStreamOutput`). Sumeru's port:
  - Drops every `@united-workforce/*` and `@ocas/core` import — Sumeru does NOT persist parser output to ocas (the server layer handles that). The function returns a pure value.
  - Renames the public function to `parseStreamJson` to match Sumeru's preferred naming.
  - Keeps the same `ClaudeCodeParsedResult` shape (sessionId, model, subtype, durationMs, numTurns, totalCostUsd, stopReason, usage, turns) but uses Sumeru's `ToolCall`/`Turn` types where possible — see "Mapping" below.
- A canonical input fixture `packages/adapter-claude-code/tests/fixtures/cc-stream.success.ndjson` ships with the package containing the four CC line types in this order: `system` (init) → `assistant` (text) → `assistant` (tool_use) → `user` (tool_result) → `assistant` (final text) → `result` (subtype `"success"`).
- Additional fixtures exist:
  - `cc-stream.max-turns.ndjson` — ends with `result.subtype = "error_max_turns"`.
  - `cc-stream.incomplete.ndjson` — system + 2 assistant lines, NO `result` line (CC was killed mid-stream).
  - `cc-stream.no-session.ndjson` — only blank/garbage lines, never produces a `system` line with `session_id`.
  - `cc-stream.malformed.ndjson` — mixes valid lines with un-parseable JSON garbage.

## When
- The unit test loads each fixture and calls `parseStreamJson(text)`.

## Then
- **Public surface** — `parseStreamJson` is the **only** named export from `stream-parser.ts`. `ClaudeCodeParsedResult` is exported from `types.ts`. No default exports. No classes. No interfaces.
- **Mapping (returned shape)** — `ClaudeCodeParsedResult` is a `type` with these fields, all required (no `?:`):
  - `type: string` — copied from the result line, falls back to `"result"`.
  - `subtype: "success" | "error_max_turns" | "error_budget" | "incomplete"` — string-literal union, no `string` widening.
  - `result: string` — final assistant text from the result line, or the last assistant turn's content for the incomplete path.
  - `sessionId: string` — extracted from the first `system` line. Empty string only when no `system` line was seen AND no result line carries it.
  - `numTurns: number` — count of parsed Sumeru `Turn`s in `turns`. NOT the value of `result.num_turns` from CC (which is last-turn-only).
  - `totalCostUsd: number` — `result.total_cost_usd` if present, else `0`.
  - `durationMs: number` — `result.duration_ms` if present, else `0`. (The adapter caller, not this parser, may overlay wall-clock duration.)
  - `model: string` — extracted from the first `system` line's `model` field. Empty string if absent.
  - `stopReason: string` — `result.stop_reason` if present, else `"incomplete_no_result_line"` for the fallback path, else `""`.
  - `usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }` — fields default to `0` when missing.
  - `turns: Turn[]` — Sumeru's `Turn` from `@sumeru/core`, NOT a CC-specific shape. See "Turn building" below.
- **Turn building** (the critical port from uwf):
  - **`assistant` lines** with `message.content` arrays:
    - Extract every `{type:"text", text}` segment, joined with `"\n"`, into `content`.
    - Extract every `{type:"tool_use", id, name, input}` segment into a `ToolCall` whose:
      - `tool: string` = `name`.
      - `input: Record<string, unknown>` = `input` if it is already an object, else `{ raw: <stringified-input> }`. Never `null`.
      - `output: string | null` = `null` at this point — paired with the matching `tool_result` user line below in a second pass.
      - `durationMs: number | null` = `null`.
      - `exitCode: number | null` = `null`.
    - Push at most ONE Turn per assistant line. If both text AND tool_use segments exist on the same line, the Turn has non-empty `content` AND `toolCalls: ToolCall[]`. If neither produces output, no Turn is emitted.
    - `role: "assistant"`, `index: <running counter starting at 0>`, `timestamp: <ISO-8601 of parse-time>` (CC's stream-json does not embed per-line timestamps; the adapter records ingestion time so the consumer always has a non-empty value), `tokens: null` (CC's per-line `usage` is per-segment-of-the-final-turn and not reliably mappable; the parser leaves token aggregation to the result line).
  - **`user` lines** carrying `{type:"tool_result", tool_use_id, content}` segments:
    - Resolve to the matching assistant turn's `ToolCall` by `tool_use_id`. Set the `ToolCall.output` to the joined text content of the `tool_result` segment(s).
    - Do **NOT** emit a separate Turn for the tool_result. (The uwf reference emits a `role: "tool_result"` turn; Sumeru deviates here because `@sumeru/core`'s `Turn.role` is `"user" | "assistant" | "system"` — there is no `tool_result` role. Tool outputs live inside the `ToolCall` of the assistant turn that initiated them.)
  - **The first `user` line on a fresh session** carries the user's prompt (when CC is invoked with `-p`); this gets emitted as a Turn with `role: "user"`, `content` = the joined text content. (Detected by absence of `tool_use_id` on its content segments.) The user turn's `index` is `0` and it precedes the first assistant turn's index. Implementations that find this redundant with the caller-provided prompt MAY skip emission and document it; the spec ACCEPTS either choice but the test fixture's expected `turns` reflects whichever is implemented.
  - **`system` lines** are NOT emitted as Turns. They populate `state.sessionId` and `state.model` only.
- **Incomplete path** — if no `result` line is parsed:
  - If at least one `system` line provided a `sessionId`, return a `ClaudeCodeParsedResult` with `subtype: "incomplete"`, `result` = the last assistant turn's `content` (or `""` if none), `stopReason: "incomplete_no_result_line"`, all other fields populated as best-effort, and `turns` = whatever was parsed.
  - If no `sessionId` was parsed AND no result line was seen, return `null`. The adapter's caller maps this to a hard error.
- **Malformed lines** — Lines that fail `JSON.parse` are silently skipped (the parser is tolerant). Lines that parse but lack a recognized `type` field are also skipped. Skipping a line never aborts the parse.
- **Determinism** — The parser is pure. Same input → same output. No I/O, no Date.now (timestamps come from a per-call `now()` injection or a constant; the test fixture's expected timestamps are matched with `expect.any(String)` plus an ISO-8601 regex on each Turn).
- **Tool-call pairing edge cases**:
  - A `tool_use` with no matching `tool_result` keeps `output: null`. The Turn is still emitted.
  - A `tool_result` with no matching `tool_use_id` is silently dropped (logged at debug only — not part of the test's hard assertions).
  - Multiple `tool_use` segments on a single assistant line each become a distinct `ToolCall` in the same Turn's `toolCalls` array, in document order.
- **`turns` invariants**:
  - `index` values are monotonically increasing starting at 0.
  - No two turns share an `index`.
  - Every turn's `content` is a `string` (possibly empty, never `null`/`undefined`).
  - A turn's `toolCalls` is `ToolCall[]` when non-empty, `null` when there are no tool calls (NOT `[]`).
- **Tests** under `packages/adapter-claude-code/tests/stream-parser.test.ts`:
  - Snapshot test for each fixture (success, max-turns, incomplete, no-session, malformed).
  - `subtype` literal-union test — `expectTypeOf<ClaudeCodeParsedResult["subtype"]>().toEqualTypeOf<"success" | "error_max_turns" | "error_budget" | "incomplete">()`.
  - Tool-call pairing test: a `tool_use` followed by a matching `tool_result` produces a `ToolCall` with non-null `output`; an unmatched `tool_use` keeps `output: null`.
  - Robustness: `parseStreamJson("")` returns `null`. `parseStreamJson("not-json\n{not:json}\n")` returns `null` (no system line, no result line).
  - Determinism: parsing the same input twice returns deeply equal objects.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
