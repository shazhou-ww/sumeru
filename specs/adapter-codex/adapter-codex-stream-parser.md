---
scenario: "stream-parser.ts parses Codex CLI's `--json` JSONL output into ordered Turn[] plus a result summary (spec blocked on spike)"
feature: adapter-codex
tags: [adapter, codex, openai, parser, jsonl, blocked]
---

## Given
- The spike (see `adapter-codex-spike-jsonl-capture.md`) has been completed.
- Captured JSONL fixtures exist at:
  - `packages/adapter-codex/tests/fixtures/codex-stream.success.jsonl`
  - `packages/adapter-codex/tests/fixtures/codex-stream.resume.jsonl`
- The JSONL schema is documented (event types, session ID field, tool-call structure, token usage).

## When
- The unit test loads each fixture and calls `parseCodexJson(text)`.

## Then
**NOTE: This spec is a placeholder. The exact assertions depend on the spike output.**

Expected structure (parallel to adapter-claude-code's `parseStreamJson`):

- **Public surface** — `parseCodexJson` is the **only** named export from `stream-parser.ts`. `CodexParsedResult` is exported from `types.ts`. No default exports.
- **Returned shape** — `CodexParsedResult` is a `type` with fields (all required, no `?:`):
  - `sessionId: string` — extracted from the JSONL stream (exact event/field TBD by spike)
  - `model: string` — if reported
  - `subtype: string` — success/error variant
  - `result: string` — final assistant text
  - `usage: { inputTokens: number; outputTokens: number }` — or a wider shape if Codex reports more
  - `turns: Turn[]` — Sumeru's `Turn` from `@sumeru/core`
- **Turn building** (TBD):
  - How are user prompts represented?
  - How are assistant messages represented?
  - How are tool calls (shell, file_write, apply_patch) encoded?
  - How are tool results paired back?
- **Incomplete path** — if the stream is truncated (no result event), return a partial result with `subtype: "incomplete"` if a session ID was found, else return `null`.
- **Malformed lines** — silently skipped (tolerant parsing).
- **Tests**:
  - Snapshot test for each fixture.
  - Tool-call pairing test.
  - Robustness: `parseCodexJson("")` returns `null`.
  - Determinism: parsing the same input twice returns deeply equal objects.

## Blocked on
- Spike completion (`adapter-codex-spike-jsonl-capture.md`)
- The exact JSON shapes for each event type
- Confirmation of session ID field name
- Confirmation of tool-call encoding
- Confirmation of token usage fields

## Next steps
After the spike:
1. Update this spec with exact field names and event types.
2. Implement `stream-parser.ts` based on the documented schema.
3. Update `adapter.ts` to use the parser.
