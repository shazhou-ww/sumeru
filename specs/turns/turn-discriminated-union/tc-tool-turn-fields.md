---
tc: ToolTurn has correct fields and no assistant-only fields
spec: turn-discriminated-union
tags: [turns, types, tool]
---

# TC: ToolTurn Fields

## Steps

1. From a completed session (task that triggers tool use), find a turn with role='tool'

## Expected

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
