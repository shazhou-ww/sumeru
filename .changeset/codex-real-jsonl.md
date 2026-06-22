---
"@sumeru/adapter-codex": minor
---

Replace fabricated Codex JSONL fixtures and stream parser with real Codex CLI v0.141.0 schema

The spike discovered that the real Codex JSONL schema is completely different from what was guessed:
- Session event: `thread.started` with `thread_id` (not `session.start` with `session_id`)
- Messages: `item.completed` with `type: "agent_message"` (not separate `user`/`assistant` events)
- Tool calls: `item.completed` with `type: "command_execution"` (not OpenAI function-call format)
- Result/end: `turn.completed` with `usage` (not `result`/`session.end`)
- Model: not emitted in stream (must come from adapter config)

Changes:
- Replaced 5 fixture files with real captures from Codex CLI v0.141.0
- Removed 2 fake fixtures (`max-turns`, `tool-use`) that used non-existent event types
- Rewrote `stream-parser.ts` to handle the 5 real event types
- Updated all tests and `buildJsonl` helper for the real schema
- Rewrote `docs/jsonl-schema.md` with accurate documentation

Fixes #55
