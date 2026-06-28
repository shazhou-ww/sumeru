---
scenario: "stream-parser.ts parses cursor-agent's `--output-format stream-json` NDJSON output into ordered Turn[] plus a result summary, mapping cursor-agent event types (system, user, thinking, assistant, tool_call, result) to Sumeru's Turn/ToolCall model"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, parser, stream-json, ndjson, turns]
---

## Given
- `@sumeru/adapter-cursor-agent` is built. The parser lives at `packages/adapter-cursor-agent/src/stream-parser.ts` and exports a single named function `parseStreamJson(stdout: string): CursorAgentParsedResult | null` plus the type `CursorAgentParsedResult` (locally defined in the package's `types.ts`).
- The cursor-agent NDJSON line types (per the spike in issue #37 comment) are:
  - `system` (subtype: `init`) — first line; carries `session_id` (UUID), `model`, `cwd`, `permissionMode`.
  - `user` — carries `message.content` array with text segments.
  - `thinking` (subtype: `delta` or `completed`) — reasoning text; discarded, NOT emitted as a Turn.
  - `assistant` — carries `message.content` array, optional `model_call_id`.
  - `tool_call` (subtype: `started`) — carries `call_id`, `tool_call.{editToolCall|shellToolCall}.args`, `model_call_id`.
  - `tool_call` (subtype: `completed`) — carries `call_id`, `tool_call.{...}.result`, `model_call_id`.
  - `result` (subtype: `success`) — carries `result`, `duration_ms`, `usage.{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}`, `request_id`.
- Unlike Claude Code's format (where tool_use is embedded in assistant message content and tool_result is a user line), cursor-agent uses **separate `tool_call` events** with explicit `started`/`completed` subtypes. The parser must map these to Sumeru's `ToolCall` model.
- Canonical fixtures at `packages/adapter-cursor-agent/tests/fixtures/`:
  - `ca-stream.simple.ndjson` — system + user + assistant text only (no tool calls).
  - `ca-stream.edit-tool.ndjson` — system + user + assistant + tool_call(editToolCall started) + tool_call(editToolCall completed) + assistant + result.
  - `ca-stream.shell-tool.ndjson` — system + user + assistant + tool_call(shellToolCall started) + tool_call(shellToolCall completed) + assistant + result.
  - `ca-stream.incomplete.ndjson` — system + assistant, NO result line (process was killed).
  - `ca-stream.no-session.ndjson` — only garbage/blank lines, no system line with session_id.
  - `ca-stream.malformed.ndjson` — mixes valid lines with un-parseable JSON garbage.

## When
- The unit test loads each fixture and calls `parseStreamJson(text)`.

## Then
- **Public surface** — `parseStreamJson` is the **only** named export from `stream-parser.ts`. `CursorAgentParsedResult` is exported from `types.ts`. No default exports. No classes. No interfaces.
- **Mapping (returned shape)** — `CursorAgentParsedResult` is a `type` with these fields, all required (no `?:`):
  - `type: string` — copied from the result line, falls back to `"result"`.
  - `subtype: "success" | "incomplete"` — string-literal union.
  - `result: string` — final assistant text from the result line, or the last assistant turn's content for the incomplete path.
  - `sessionId: string` — extracted from the first `system` line's `session_id` field. Empty string only when no system line was seen.
  - `numTurns: number` — count of parsed Sumeru `Turn`s in `turns`.
  - `durationMs: number` — `result.duration_ms` if present, else `0`.
  - `model: string` — extracted from the first `system` line's `model` field. Empty string if absent.
  - `usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }` — fields default to `0` when missing.
  - `turns: Turn[]` — Sumeru's `Turn` from `@sumeru/core`.
- **Turn building** — the critical mapping from cursor-agent events:
  - **`assistant` lines** with `message.content` arrays:
    - Extract every text segment, joined with `"\n"`, into `content`.
    - Push as a Turn with `role: "assistant"`, `toolCalls: null` at this point (tool calls arrive as separate events).
    - If content is empty, do NOT emit a Turn.
  - **`tool_call` (subtype: `started`)** events:
    - Create a pending `ToolCall` entry: `tool` = the key under `tool_call` (e.g. `"editToolCall"` or `"shellToolCall"`), `input` = the `.args` object, `output: null`, `durationMs: null`, `exitCode: null`.
    - Associate with the most recent assistant Turn. If the most recent Turn has `toolCalls: null`, set it to `[call]`; otherwise append.
    - Track by `call_id` for later completion.
  - **`tool_call` (subtype: `completed`)** events:
    - Find the pending `ToolCall` by `call_id`.
    - Set `output` to the stringified result (or the result's `stdout`/content if it's a structured object).
    - For `shellToolCall`, extract `exitCode` from `result.exitCode` if present.
    - For `editToolCall`, `exitCode` remains `null`.
  - **`user` lines** carrying the initial prompt:
    - Emit as a Turn with `role: "user"`, `content` = joined text from `message.content`.
  - **`thinking` lines** are completely discarded — NOT emitted as Turns.
  - **`system` lines** are NOT emitted as Turns. They populate `state.sessionId` and `state.model` only.
- **Incomplete path** — if no `result` line is parsed:
  - If at least one `system` line provided a `sessionId`, return a `CursorAgentParsedResult` with `subtype: "incomplete"`, `result` = the last assistant turn's content (or `""`), all other fields populated as best-effort, and `turns` = whatever was parsed.
  - If no `sessionId` was parsed AND no result line was seen, return `null`.
- **Malformed lines** — Lines that fail `JSON.parse` are silently skipped. Lines with an unrecognized `type` field are also skipped.
- **Tool-call pairing edge cases**:
  - A `tool_call started` with no matching `completed` keeps `output: null`. The Turn is still emitted.
  - A `tool_call completed` with no matching `started` `call_id` is silently dropped.
  - Multiple tool_call events between two assistant lines all attach to the most recent preceding assistant Turn.
- **`turns` invariants**:
  - `index` values are monotonically increasing starting at 0.
  - No two turns share an `index`.
  - Every turn's `content` is a `string` (possibly empty, never `null`/`undefined`).
  - A turn's `toolCalls` is `ToolCall[]` when non-empty, `null` when there are no tool calls (NOT `[]`).
- **Tests** under `packages/adapter-cursor-agent/tests/stream-parser.test.ts`:
  - Snapshot test for each fixture (simple, edit-tool, shell-tool, incomplete, no-session, malformed).
  - Tool-call pairing test: a `started` followed by a matching `completed` produces a `ToolCall` with non-null `output`; an unmatched `started` keeps `output: null`.
  - shellToolCall extracts exitCode; editToolCall has exitCode `null`.
  - Thinking lines are discarded — no Turn with content matching reasoning text.
  - Robustness: `parseStreamJson("")` returns `null`. `parseStreamJson("not-json\n")` returns `null`.
  - Determinism: parsing the same input twice returns deeply equal objects.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
