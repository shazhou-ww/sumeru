---
scenario: "parseCodexJsonIncremental yields StreamParseEvent for real Codex v0.141.0 events (thread.started/item.completed/turn.completed)"
feature: adapter-codex
tags: [adapter, codex, streaming, incremental, jsonl, parser]
---

## Given
- `parseCodexJsonIncremental` in `stream-parser.ts` is an async generator that accepts `AsyncIterable<string>` and yields `StreamParseEvent`.
- The real Codex v0.141.0 JSONL schema uses: `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`.
- The `StreamParseEvent` discriminated union is:
  ```typescript
  type StreamParseEvent =
    | { type: "meta"; sessionId: string; model: string }
    | { type: "turn"; turn: Turn }
    | { type: "result"; resultLine: Record<string, unknown> };
  ```

## When
- The test feeds lines from `codex-stream.success.jsonl` one-by-one into `parseCodexJsonIncremental`.

## Then

### Event sequence for success fixture

Given the success fixture line order:
1. `"Reading additional input from stdin..."` — non-JSON, skipped, no yield
2. `thread.started` — yields `{ type: "meta", sessionId: "019eee31-...", model: "" }`
3. `turn.started` — no yield
4. `item.completed` (agent_message, item_0) — yields `{ type: "turn", turn: {index:0, role:"assistant", content:"I'll create...", toolCalls:null} }`
5. `item.started` (command_execution, item_1) — no yield (status: "in_progress")
6. `item.completed` (command_execution, item_1) — yields `{ type: "turn", turn: {index:1, role:"assistant", content:"", toolCalls:[{tool:"command_execution", ...}]} }`
7. `item.completed` (agent_message, item_2) — yields `{ type: "turn", turn: {index:2, role:"assistant", content:"hello.txt created...", toolCalls:null} }`
8. `turn.completed` — yields `{ type: "result", resultLine: {type:"turn.completed", usage:{input_tokens:17677, ...}} }`

### Incremental behavior

- Turns are yielded BEFORE the stream ends — consumer receives turns as each `item.completed` line arrives.
- The `meta` event is yielded exactly once, on the first `thread.started` line.
- The `result` event is yielded exactly once, on the `turn.completed` line.
- No event is yielded for `turn.started` or `item.started` lines.
- Non-JSON lines and unknown event types produce no yield.

### Model field

- `model` in the `meta` event is `""` (empty string) because Codex v0.141.0 does not emit model info in the stream.
- The adapter is responsible for supplying the model from its configuration.

### Consistency with batch parser

- Collecting all yielded turns and the result event produces the same logical output as `parseCodexJson(fullText)`:
  - Same number of turns, same content, same tool calls.
  - Same sessionId, same usage values.

### Tests

- Feed lines with artificial delays; verify turns arrive before the "exit" signal.
- Verify `meta` event fires after `thread.started` line (not after the full stream).
- Verify `item.started` events do NOT yield turns.
- Verify malformed lines mid-stream do not crash the generator.
- Verify empty async iterable yields no events.
