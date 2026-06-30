---
tc: AssistantTurn has correct fields
spec: turn-discriminated-union
tags: [turns, types, assistant]
---

# TC: AssistantTurn Fields

## Steps

1. From a completed session's turn list, find a turn with role='assistant'

## Expected

- Has `id` (number)
- Has `role` = 'assistant'
- Has `content` (string)
- Has `toolCalls` (array)
- Has `tokenUsage` (object with input, output, cached — or null)
- Has `durationMs` (number)
- Has `timestamp` (string, ISO format)
