---
tc: ToolTurn has correct fields and no assistant-only fields
spec: turn-discriminated-union
tags: [turns, types, tool]
status: NOT_APPLICABLE (adapter-hermes)
---

# TC: ToolTurn Fields

## Current Behavior (adapter-hermes)

adapter-hermes does NOT emit independent `role: "tool"` turns. Instead, tool call
information is embedded in the assistant turn's `toolCalls[]` array as `WireToolCall`
objects with fields: `{tool, input, output, durationMs, exitCode}`.

This tc would apply to a future adapter that emits tool results as separate turns.

## Steps (for an adapter that emits tool turns)

1. From a completed session (task that triggers tool use), find a turn with role='tool'

## Expected (when applicable)

- Has `id` (number)
- Has `role` = 'tool'
- Has `callId` (string)
- Has `name` (string)
- Has `result` (string)
- Has `durationMs` (number)
- Has `timestamp` (string, ISO format)
- Does NOT have `content`
- Does NOT have `toolCalls`
- Does NOT have `tokenUsage`

## Verification (2026-06-30)

Tested with adapter-hermes: sessions always produce only `role: "assistant"` turns.
Tool interactions are captured in `assistantTurn.toolCalls[]` instead.
This tc is structurally valid but NOT testable with current adapters.
