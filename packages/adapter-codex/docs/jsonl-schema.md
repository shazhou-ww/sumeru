# Codex CLI JSONL Schema (v0.141.0)

This document describes the real JSONL output schema from `codex exec --json`,
captured from `@openai/codex` v0.141.0.

## Event Types

The stream emits exactly **5 event types** (discriminated by the `type` field):

| Event | Payload | Role |
|-------|---------|------|
| `thread.started` | `{ thread_id: string }` | Session init; carries the resumable ID |
| `turn.started` | `{}` | Marks beginning of a turn (no fields) |
| `item.started` | `{ item: CodexItem }` | Tool execution begins (status: "in_progress") |
| `item.completed` | `{ item: CodexItem }` | Message or tool result finalized |
| `turn.completed` | `{ usage: CodexUsage }` | Marks end of a turn; carries token counts |

## Session Start

```json
{"type":"thread.started","thread_id":"019eee31-d98e-7dc1-a198-59e59cd58310"}
```

- Field: `thread_id` (NOT `session_id`)
- Format: UUID v7
- This is the first JSON line of the stream (after an optional non-JSON stdin message)

## Item Types (CodexItem)

Items appear within `item.started` and `item.completed` events.

### Agent Message

```json
{
  "id": "item_0",
  "type": "agent_message",
  "text": "I'll create hello.txt..."
}
```

### Command Execution

```json
{
  "id": "item_1",
  "type": "command_execution",
  "command": "/bin/bash -lc \"printf 'Hello World\\n' > hello.txt && cat hello.txt\"",
  "aggregated_output": "Hello World\n",
  "exit_code": 0,
  "status": "completed"
}
```

Fields:
- `id`: Monotonically increasing item identifier (`item_N`)
- `type`: `"agent_message"` | `"command_execution"`
- `text`: Agent message text content (agent_message only)
- `command`: Full shell command string (command_execution only)
- `aggregated_output`: Combined stdout/stderr output (command_execution only)
- `exit_code`: Integer exit code, or `null` if still in_progress (command_execution only)
- `status`: `"completed"` | `"in_progress"` (command_execution only)

## Token Usage (CodexUsage)

Reported in the `turn.completed` event:

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 17677,
    "cached_input_tokens": 15872,
    "output_tokens": 97,
    "reasoning_output_tokens": 0
  }
}
```

Fields:
- `input_tokens`: Total input tokens consumed
- `output_tokens`: Output tokens generated
- `cached_input_tokens`: Input tokens served from cache
- `reasoning_output_tokens`: Tokens used for reasoning (0 for non-reasoning models)

## First Line Behavior

The first line of stdout is always a non-JSON text message:
- `"Reading additional input from stdin..."` (piped input)
- `"Reading prompt from stdin..."` (interactive prompt)

The parser MUST skip non-JSON lines.

## Model Field

The model is **NOT** reported in the JSONL stream. It must be inferred from
the adapter configuration (`--model` flag passed to `codex exec`).

## Resume Behavior

When using `codex exec resume <thread_id> "<prompt>" --json`:
- Emits `thread.started` with the **same** `thread_id`
- Only delta (new) items are emitted; prior context is NOT re-emitted
- Token counts in `turn.completed` reflect the resumed turn only

## Complete Example

```
Reading additional input from stdin...
{"type":"thread.started","thread_id":"019eee31-d98e-7dc1-a198-59e59cd58310"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I'll create hello.txt..."}}
{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/bash -lc \"printf 'Hello World\\n' > hello.txt\"","aggregated_output":"","exit_code":null,"status":"in_progress"}}
{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"/bin/bash -lc \"printf 'Hello World\\n' > hello.txt\"","aggregated_output":"Hello World\n","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Done!"}}
{"type":"turn.completed","usage":{"input_tokens":17677,"cached_input_tokens":15872,"output_tokens":97,"reasoning_output_tokens":0}}
```

## Parser Tolerance

The parser is designed to be tolerant:
- Non-JSON lines are silently skipped (handles the first-line stdin message)
- Unknown event types are silently skipped
- Unknown item types within `item.completed` are silently skipped
- Malformed JSON lines are silently skipped
- `item.started` events (status: "in_progress") do NOT produce turns
- `turn.started` events are no-ops (informational markers)
