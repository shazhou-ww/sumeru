# Codex CLI JSONL Schema

This document describes the expected JSONL output schema from `codex exec --json`.

> **Note**: This schema is based on expected Codex CLI behavior. The exact schema
> should be verified by running the spike described in `specs/adapter-codex-spike-jsonl-capture.md`.

## Event Types

### Session Start Event

Emitted at the beginning of a `codex exec` run.

```json
{
  "type": "session.start",
  "session_id": "<uuid>",
  "model": "<model-name>",
  "cwd": "<working-directory>"
}
```

Fields:
- `type`: `"session.start"` | `"session_start"` | `"init"` | `"system"`
- `session_id` / `sessionId`: The resumable session identifier
- `model`: The model used for this session
- `cwd`: The working directory (optional)

### Message Events

User and assistant messages.

```json
{
  "type": "user",
  "role": "user",
  "content": "<text>"
}
```

```json
{
  "type": "assistant",
  "role": "assistant",
  "content": "<text>",
  "tool_calls": [
    {
      "id": "<tool-call-id>",
      "type": "function",
      "function": {
        "name": "<tool-name>",
        "arguments": "<json-string>"
      }
    }
  ]
}
```

Fields:
- `type`: `"message"` | `"user"` | `"assistant"`
- `role`: `"user"` | `"assistant"`
- `content`: Text content (string or array of content blocks)
- `tool_calls`: Array of tool call objects (assistant only)

### Tool Output Events

Results from tool execution.

```json
{
  "type": "tool_call_output",
  "tool_call_id": "<tool-call-id>",
  "output": "<result-text>"
}
```

Alternative field names:
- `type`: `"function_call_output"` | `"tool_output"` | `"tool_result"`
- `function_call_id` / `id`: The matching tool call identifier
- `content` / `result`: The output text

### Result Event

Emitted at the end of a successful run.

```json
{
  "type": "result",
  "subtype": "success",
  "session_id": "<uuid>",
  "duration_ms": 1234,
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 100,
    "output_tokens": 50
  }
}
```

Alternative event types: `"session.end"` | `"session_end"` | `"done"` | `"complete"`

Subtype values:
- `"success"` / `"completed"` / `"done"`: Normal completion
- `"error"` / `"error_max_turns"` / `"error_budget"`: Error conditions

## Parser Tolerance

The parser is designed to be tolerant:
- Unknown fields are ignored
- Missing optional fields use sensible defaults
- Malformed JSON lines are silently skipped
- Session ID can be extracted from either `session.start` or `result` events

## Resume Behavior

When using `codex exec resume <session_id> "<prompt>"`:
- The same JSONL schema is used
- Only delta (new) turns are emitted
- The session_id in events matches the resumed session
