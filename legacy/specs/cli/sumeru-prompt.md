---
scenario: "sumeru prompt <name> prints a ready-to-use LLM prompt for Sumeru integration"
feature: cli-prompt
tags: [cli, prompt, llm, integration, docs]
---

## Given

- Sumeru is installed and `sumeru` CLI is on `PATH`.
- The `prompt` subcommand accepts a single positional argument `<name>` selecting a prompt template.
- Available prompt templates:
  - `usage` — Sumeru HTTP API quick reference (endpoints, envelope format, SSE event types, error codes)
  - `adapter-dev` — How to write a new adapter package (Adapter interface, NativeSessionRef, lifecycle, stream-parser)
- Output is plain markdown written to stdout — no ANSI colors, no interactive prompts.
- Templates are maintained as static `.md` files under `packages/cli/src/prompts/` and embedded at build time (no runtime file reads).

## When

- The contributor runs `sumeru prompt usage`.
- Or runs `sumeru prompt adapter-dev`.

## Then

- The process prints the selected prompt template to stdout and exits 0.
- `sumeru prompt` with no argument exits non-zero and prints: `error: missing prompt name. Available: usage, adapter-dev`.
- `sumeru prompt bogus` exits non-zero and prints: `error: unknown prompt "bogus". Available: usage, adapter-dev`.
- `sumeru prompt --help` lists available prompt names with one-line descriptions.
- The `usage` prompt includes:
  - All HTTP endpoints (method + path + response type)
  - ocas envelope format (`{ type, value }`)
  - SSE event types (`turn`, `heartbeat`, `done`, `error`)
  - Error codes and HTTP status code table
  - `Last-Event-ID` resume mechanism
  - Session lifecycle (create → send → close)
- The `adapter-dev` prompt includes:
  - Adapter interface signature (`createSession`, `send`, `close`, `getTurns`)
  - `NativeSessionRef` type and expectations
  - `AgentResponse` / `Turn` / `ToolCall` types
  - Stream-parser contract (input format → Turn[])
  - Package scaffold checklist (package.json, tsconfig, index.ts, types.ts)
  - Server integration steps (`build-adapters.ts` registration)

## Notes

- Prompts are designed to be pasted directly into an LLM context window — they give the model everything it needs to write Sumeru-compatible code.
- Keep prompts under 4000 chars; prefer concise reference tables over prose.
- When a new endpoint, event type, or error code is added, the corresponding prompt must be updated in the same PR.
- Implements Issue #47.
