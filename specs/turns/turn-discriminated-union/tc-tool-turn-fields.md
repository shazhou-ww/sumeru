---
tc: ToolTurn has correct fields and no assistant-only fields
spec: turn-discriminated-union
tags: [turns, types, tool, bug-182]
status: PASS
---

# TC: ToolTurn Fields

> **Status note:** Was `NOT_APPLICABLE (adapter-hermes)` because adapter-hermes
> never emitted `role: "tool"` turns. Issue #182 makes adapter-hermes emit
> independent tool turns from ACP `tool_result` events, so this tc becomes
> testable once #182 lands (see `specs/adapter/adapter-hermes-progressive-turns.md`).

## Behavior under test (after #182)

adapter-hermes emits an independent `role: "tool"` turn for each ACP `tool_result`
event, separate from the assistant turn that requested it. The public `ToolTurn`
shape is defined in `packages/core/src/types.ts:87-95`.

## Setup

1. Sumeru host running (port 7901), an adapter-hermes session created.

## Steps

1. Drive a task that triggers a tool call (e.g. a prompt that runs `terminal` with `ls`).
2. Fetch the turns and find one with `role === "tool"`:
   ```bash
   curl -s http://127.0.0.1:7901/sessions/<id>/turns | jq '.[] | select(.role=="tool")'
   ```

## Expected

- [ ] Has `id` (number)
- [ ] Has `role` = 'tool'
- [ ] Has `callId` (string) — matches the requesting assistant turn's tool call
- [ ] Has `name` (string)
- [ ] Has `result` (string)
- [ ] Has `durationMs` (number)
- [ ] Has `timestamp` (string, ISO format)
- [ ] Does NOT have `content`
- [ ] Does NOT have `toolCalls`
- [ ] Does NOT have `tokenUsage`

## Failure Signals

- No `role:"tool"` turn present, only `role:"assistant"` → #182 not implemented; adapter
  still collapses the loop into one assistant turn.
- Tool info only inside `assistantTurn.toolCalls[]` → host did not surface the wire
  `role:"tool"` frame as a public `ToolTurn` (`packages/host/src/wire-turn.ts`).

## History

- 2026-06-30 (pre-#182): adapter-hermes produced only `role:"assistant"` turns; tool
  interactions were captured in `assistantTurn.toolCalls[]`. Marked NOT_APPLICABLE.
- #182: re-enabled — adapter-hermes now emits progressive turns incl. `role:"tool"`.
