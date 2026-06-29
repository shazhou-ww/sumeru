---
scenario: "Replace synthesized fixtures and schema doc with real Codex v0.141.0 JSONL captures"
feature: adapter-codex
tags: [adapter, codex, fixtures, jsonl, schema, docs]
---

## Given
- Real Codex CLI v0.141.0 JSONL output was captured at `/tmp/codex-spike/`:
  - `codex-capture.jsonl` — success with command_execution (create+read file)
  - `codex-resume-capture.jsonl` — resume on same thread_id (delete file)
  - `codex-simple.jsonl` — arithmetic response, no tool use
  - `codex-incomplete.jsonl` — truncated, missing `turn.completed`
  - `codex-malformed.jsonl` — contains `{"type":"invalid","broken":` and bare text lines
- Current fixtures at `packages/adapter-codex/tests/fixtures/` use fabricated event types:
  - `codex-stream.success.jsonl` uses `session.start`, `user`, `assistant`, `result`
  - `codex-stream.resume.jsonl` uses `session.start`, `user`, `assistant`, `tool_call_output`, `result`
  - `codex-stream.incomplete.jsonl`, `codex-stream.malformed.jsonl`, `codex-stream.max-turns.jsonl`, `codex-stream.tool-use.jsonl` — all use the fake schema
- Current `packages/adapter-codex/docs/jsonl-schema.md` documents a fictional schema with disclaimer "should be verified by running the spike".

## When
- The contributor replaces fixtures and updates documentation:
  1. Copy `/tmp/codex-spike/codex-capture.jsonl` → `tests/fixtures/codex-stream.success.jsonl`
  2. Copy `/tmp/codex-spike/codex-resume-capture.jsonl` → `tests/fixtures/codex-stream.resume.jsonl`
  3. Copy `/tmp/codex-spike/codex-simple.jsonl` → `tests/fixtures/codex-stream.simple.jsonl` (new name)
  4. Copy `/tmp/codex-spike/codex-incomplete.jsonl` → `tests/fixtures/codex-stream.incomplete.jsonl`
  5. Copy `/tmp/codex-spike/codex-malformed.jsonl` → `tests/fixtures/codex-stream.malformed.jsonl`
  6. Remove `tests/fixtures/codex-stream.max-turns.jsonl` (fake, no real equivalent yet)
  7. Remove `tests/fixtures/codex-stream.tool-use.jsonl` (redundant — success.jsonl has tool use)
  8. Rewrite `docs/jsonl-schema.md` with the real schema

## Then

### Fixture files contain real data

Each fixture file in `packages/adapter-codex/tests/fixtures/` contains ONLY valid Codex v0.141.0 event lines (except the intentional malformed fixture):

- **codex-stream.success.jsonl** — First non-JSON line (stdin message), then: `thread.started` → `turn.started` → `item.completed`(agent_message) → `item.started`(command_execution) → `item.completed`(command_execution) → `item.completed`(agent_message) → `turn.completed`(usage)
- **codex-stream.resume.jsonl** — Same structure, same `thread_id` as success, different items
- **codex-stream.simple.jsonl** — `thread.started` → `turn.started` → `item.completed`(agent_message) → `turn.completed`(usage). No command_execution items.
- **codex-stream.incomplete.jsonl** — Same as success but WITHOUT the final `turn.completed` line
- **codex-stream.malformed.jsonl** — `thread.started` → `turn.started` → `item.completed` → truncated JSON → bare text → `turn.completed`

### No fake event types remain

None of the fixture files contain any of these fabricated types:
- `session.start` / `session_start`
- `user` / `assistant` / `message`
- `tool_call_output` / `function_call_output`
- `result` / `session.end` / `done` / `complete`

### Schema documentation is accurate

`packages/adapter-codex/docs/jsonl-schema.md`:
- Does NOT contain the disclaimer "should be verified by running the spike"
- Documents exactly 5 event types: `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed`
- Documents both item types: `agent_message`, `command_execution`
- Documents the `usage` shape with all 4 fields: `input_tokens`, `output_tokens`, `cached_input_tokens`, `reasoning_output_tokens`
- Documents that session ID is `thread_id` (NOT `session_id`)
- Documents that model is NOT reported in the stream
- Documents first-line stdin message behavior

### Removed files

- `tests/fixtures/codex-stream.max-turns.jsonl` — deleted (used fake schema)
- `tests/fixtures/codex-stream.tool-use.jsonl` — deleted (used fake schema; tool use is in success.jsonl)

### Tests still pass

- `pnpm run build` exits 0
- `pnpm run test` exits 0 (stream-parser tests updated to match new fixtures)
- `pnpm run check` exits 0
