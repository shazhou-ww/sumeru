---
scenario: "Spike completed: real Codex CLI v0.141.0 JSONL captured, schema documented, fixtures replaced"
feature: adapter-codex
tags: [spike, adapter, codex, openai, jsonl, schema, completed]
---

## Given
- Codex CLI (`@openai/codex` v0.141.0) is installed and authenticated via `OPENAI_API_KEY`.
- Real JSONL output was captured at `/tmp/codex-spike/` with five scenarios:
  - `codex-capture.jsonl` — success with command_execution tool use
  - `codex-resume-capture.jsonl` — resume on the same thread_id
  - `codex-simple.jsonl` — simple response, no tool use
  - `codex-incomplete.jsonl` — truncated stream (no `turn.completed`)
  - `codex-malformed.jsonl` — contains invalid JSON lines mixed with valid events

## When
- The contributor runs the spike deliverables update:
  1. Copies real captures into `packages/adapter-codex/tests/fixtures/`
  2. Rewrites `packages/adapter-codex/docs/jsonl-schema.md` with observed schema
  3. Removes the "should be verified by running the spike" disclaimer

## Then

### 1. Real JSONL Event Schema (Codex v0.141.0)

The stream emits exactly **5 event types** (`type` field):

| Event | Payload | Role |
|-------|---------|------|
| `thread.started` | `{ thread_id: string }` | Session init; carries the resumable ID |
| `turn.started` | `{}` | Marks beginning of a turn (no fields) |
| `item.started` | `{ item: CodexItem }` | Tool execution begins (status: "in_progress") |
| `item.completed` | `{ item: CodexItem }` | Message or tool result finalized |
| `turn.completed` | `{ usage: CodexUsage }` | Marks end of a turn; carries token counts |

**CodexItem** shape:
```json
{
  "id": "item_N",
  "type": "agent_message" | "command_execution",
  "text": "...",                    // agent_message only
  "command": "/bin/bash -lc ...",   // command_execution only
  "aggregated_output": "...",       // command_execution only
  "exit_code": 0 | null,           // command_execution only
  "status": "completed" | "in_progress"  // command_execution only
}
```

**CodexUsage** shape:
```json
{
  "input_tokens": 17677,
  "cached_input_tokens": 15872,
  "output_tokens": 97,
  "reasoning_output_tokens": 0
}
```

### 2. Session ID surfacing

- Field: `thread_id` (NOT `session_id`)
- Event: `thread.started` (first JSON line of the stream)
- Format: UUID v7 (`019eee31-d98e-7dc1-a198-59e59cd58310`)

### 3. Tool-call representation

- Codex uses `command_execution` items (NOT OpenAI function-call format)
- Tool name is implicit: `type: "command_execution"`
- Input: `item.command` field (full shell command string)
- Output: `item.aggregated_output` field (stdout/stderr combined)
- Exit code: `item.exit_code` (integer or null if in_progress)
- Pairing: `item.id` field (`item_N`) links `item.started` and `item.completed`

### 4. Token usage

- Reported in `turn.completed` event (NOT in a separate result event)
- Fields: `usage.input_tokens`, `usage.output_tokens`, `usage.cached_input_tokens`, `usage.reasoning_output_tokens`
- No separate "result" or "session.end" event exists

### 5. Model field

- **Not emitted** in the JSONL stream
- Model must be inferred from adapter configuration (the `--model` flag)

### 6. Auth verification

- Headless `OPENAI_API_KEY` mode works without browser auth.
- `--skip-git-repo-check` required for non-git directories.

### 7. Resume round-trip

- `codex exec resume <thread_id> "<prompt>" --json` works correctly
- Emits the same `thread.started` with the same `thread_id`
- Only delta (new) items are emitted; prior context is NOT re-emitted
- Token counts in `turn.completed` reflect the resumed turn only

### 8. First line behavior

- Line 1 of stdout is always a non-JSON text line: `"Reading additional input from stdin..."` or `"Reading prompt from stdin..."`
- The parser MUST skip non-JSON lines (already handled by malformed-line tolerance)

## Deliverables

- `packages/adapter-codex/tests/fixtures/codex-stream.success.jsonl` — real capture with command_execution
- `packages/adapter-codex/tests/fixtures/codex-stream.resume.jsonl` — real resume capture
- `packages/adapter-codex/tests/fixtures/codex-stream.simple.jsonl` — simple response (no tool use)
- `packages/adapter-codex/tests/fixtures/codex-stream.incomplete.jsonl` — truncated (no turn.completed)
- `packages/adapter-codex/tests/fixtures/codex-stream.malformed.jsonl` — mixed valid/invalid lines
- `packages/adapter-codex/docs/jsonl-schema.md` — updated with real schema, disclaimer removed

## Notes
- The previous fixture files used fabricated event types (`session.start`, `user`, `assistant`, `tool_call_output`, `result`) that do not exist in real Codex output.
- The `codex-stream.max-turns.jsonl` and `codex-stream.tool-use.jsonl` fixtures should be removed since they use the fake schema.
- This spike unblocks #57 (stream-parser implementation).
