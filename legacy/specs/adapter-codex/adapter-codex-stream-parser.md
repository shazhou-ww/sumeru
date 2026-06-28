---
scenario: "stream-parser.ts parses real Codex CLI v0.141.0 JSONL output (thread.started/item.completed/turn.completed) into Turn[] plus result summary"
feature: adapter-codex
tags: [adapter, codex, openai, parser, jsonl]
---

## Given
- The spike (`adapter-codex-spike-jsonl-capture.md`) is completed with real Codex v0.141.0 output.
- Real JSONL fixtures exist at:
  - `packages/adapter-codex/tests/fixtures/codex-stream.success.jsonl` — tool use scenario
  - `packages/adapter-codex/tests/fixtures/codex-stream.resume.jsonl` — resume scenario
  - `packages/adapter-codex/tests/fixtures/codex-stream.simple.jsonl` — no tool use
  - `packages/adapter-codex/tests/fixtures/codex-stream.incomplete.jsonl` — truncated stream
  - `packages/adapter-codex/tests/fixtures/codex-stream.malformed.jsonl` — invalid lines mixed in
- The real JSONL schema uses event types: `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`.
- Item types are `agent_message` (text) and `command_execution` (tool call).

## When
- The unit test loads each fixture and calls `parseCodexJson(text)`.

## Then

### Public surface

- `parseCodexJson` is the **only batch** named export from `stream-parser.ts`.
- `parseCodexJsonIncremental` is the **only streaming** named export from `stream-parser.ts`.
- `CodexParsedResult` is exported from `types.ts`.
- No default exports.

### Event type handling

The parser recognizes exactly these event types:

| `type` value | Action |
|---|---|
| `thread.started` | Extract `thread_id` as sessionId |
| `turn.started` | No-op (informational marker) |
| `item.started` | No-op (informational; item is in_progress) |
| `item.completed` | Build a Turn from the item |
| `turn.completed` | Extract `usage` as the result/terminal event |

All other `type` values and non-JSON lines are silently skipped.

### Turn building from `item.completed`

**Agent message** (`item.type === "agent_message"`):
```typescript
{
  index: N,          // monotonically increasing from 0
  role: "assistant",
  content: item.text,
  timestamp: <ISO-8601>,
  toolCalls: null,
  tokens: null,
  hash: null,
}
```

**Command execution** (`item.type === "command_execution"` with `status === "completed"`):
```typescript
{
  index: N,
  role: "assistant",
  content: "",
  timestamp: <ISO-8601>,
  toolCalls: [{
    tool: "command_execution",
    input: { command: item.command },
    output: item.aggregated_output,
    durationMs: null,
    exitCode: item.exit_code,  // number | null
  }],
  tokens: null,
  hash: null,
}
```

- Items with `status !== "completed"` (i.e., from `item.started` events) do NOT produce turns.
- Each `item.completed` produces exactly one Turn regardless of item type.

### Returned shape (`CodexParsedResult`)

```typescript
type CodexParsedResult = {
  type: string;             // "result"
  subtype: CodexResultSubtype;  // "success" | "error" | "incomplete"
  result: string;           // last agent_message text
  sessionId: string;        // from thread.started → thread_id
  numTurns: number;         // turns.length
  durationMs: number;       // 0 (not reported in stream; comes from SpawnExitInfo)
  model: string;            // "" (not in stream; from adapter config)
  stopReason: string;       // "turn_completed" when turn.completed present
  usage: {
    inputTokens: number;    // from turn.completed → usage.input_tokens
    outputTokens: number;   // from turn.completed → usage.output_tokens
  };
  turns: Turn[];
};
```

### Fixture: `codex-stream.success.jsonl`

Parsing this fixture returns:
- `sessionId` = `"019eee31-d98e-7dc1-a198-59e59cd58310"`
- `subtype` = `"success"`
- `model` = `""`
- `numTurns` = 3 (agent_message + command_execution + agent_message)
- `turns[0]`: role="assistant", content starts with "I'll create", toolCalls=null
- `turns[1]`: role="assistant", content="", toolCalls=[{tool:"command_execution", input:{command: contains "printf 'Hello World'"}, output:"Hello World\n", exitCode:0}]
- `turns[2]`: role="assistant", content contains "created and read successfully", toolCalls=null
- `usage.inputTokens` = 17677
- `usage.outputTokens` = 97
- `stopReason` = `"turn_completed"`
- `result` = content of turns[2] (last agent_message)

### Fixture: `codex-stream.simple.jsonl`

Parsing returns:
- `sessionId` = `"019eee32-d812-7f31-bb4b-f43b1abd7b13"`
- `subtype` = `"success"`
- `numTurns` = 1 (single agent_message)
- `turns[0]`: role="assistant", content="4", toolCalls=null
- `usage.inputTokens` = 8774
- `usage.outputTokens` = 5

### Fixture: `codex-stream.resume.jsonl`

Parsing returns:
- `sessionId` = `"019eee31-d98e-7dc1-a198-59e59cd58310"` (same thread_id as original)
- `subtype` = `"success"`
- `numTurns` = 3
- `turns[1].toolCalls[0].output` contains `"hello.txt is gone"`
- `usage.inputTokens` = 35690

### Fixture: `codex-stream.incomplete.jsonl`

Parsing returns:
- `sessionId` = `"019eee31-d98e-7dc1-a198-59e59cd58310"`
- `subtype` = `"incomplete"` (no `turn.completed` event found)
- `numTurns` = 3 (items still parsed)
- `usage.inputTokens` = 0
- `usage.outputTokens` = 0
- `stopReason` = `"incomplete_no_result_line"`

### Fixture: `codex-stream.malformed.jsonl`

Parsing returns:
- `sessionId` = `"019eee31-d98e-7dc1-a198-59e59cd58310"`
- `subtype` = `"success"` (turn.completed found after malformed lines)
- `numTurns` = 1 (only the valid agent_message item before the malformed lines)
- Invalid JSON lines (`{"type":"invalid","broken":` and `not json at all`) are silently skipped
- `usage.inputTokens` = 100
- `usage.outputTokens` = 5

### Edge cases

- `parseCodexJson("")` returns `null`.
- `parseCodexJson("not json\nalso not json")` returns `null`.
- First line `"Reading additional input from stdin..."` is skipped (not valid JSON).
- Parsing the same input twice returns deeply-equal objects (deterministic).
- Unknown item types (neither `agent_message` nor `command_execution`) are silently skipped.

### Removed: fake event types

The parser MUST NOT handle these previously-guessed event types (they do not exist in real Codex output):
- `session.start` / `session_start` / `init`
- `message` / `user` / `assistant`
- `function_call_output` / `tool_call_output` / `tool_output` / `tool_result`
- `session.end` / `done` / `result` / `complete`

### Tests

- Snapshot test for each of the 5 fixtures.
- Tool-call extraction test: `turns[1].toolCalls[0]` has correct command, output, exitCode.
- Empty input: `parseCodexJson("")` returns `null`.
- Determinism: parsing same input twice returns deeply-equal objects.
- Non-JSON first line is skipped gracefully.
- `item.started` events (status: "in_progress") do NOT produce turns.
