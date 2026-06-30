---
"@sumeru/adapter-core": minor
"@sumeru/adapter-hermes": minor
"@sumeru/host": patch
---

fix: adapter-hermes emits progressive turns via ACP stream (#182)

Previously the hermes adapter collapsed tool interactions into a single assistant
turn: `tool_call` flushed pending text with `toolCalls: null`, deferred calls to
`pendingToolCalls` for a later frame, and `tool_result` events were never parsed.
The host therefore never saw independent tool turns in the NDJSON stream.

Changes:
- **@sumeru/adapter-core** — `TurnValue` is now a discriminated union:
  `AssistantTurnValue | ToolTurnValue`. The new `ToolTurnValue` variant
  (`role: "tool"`) carries `name`, `callId`, `result`, `durationMs`, and
  `timestamp` — no `content`/`toolCalls`/`tokens`.
- **@sumeru/adapter-hermes** — `parseSessionUpdate()` handles `tool_result`
  events from the ACP stream. `mapUpdateToTurns()` now flushes pending text
  **with** the `toolCalls` array on a single assistant frame (not null), and
  emits an independent `role:"tool"` turn for each `tool_result`. The deferred
  `pendingToolCalls` accumulator is removed.
- **@sumeru/host** — `wireTurnsToV3()` recognizes `role:"tool"` wire turns and
  surfaces them as public `ToolTurn` objects. `search.ts` and
  `session-manager.ts` narrow on the discriminant before accessing
  assistant-only fields.

The progressive sequence is now: assistant(toolCalls) → tool → assistant, with
monotonically increasing turn indices across multi-round tool loops.

Refs: #182
