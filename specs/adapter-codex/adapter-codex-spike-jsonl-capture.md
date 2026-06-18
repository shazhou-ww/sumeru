---
scenario: "Spike: capture real `codex exec --json` output to document the JSONL event schema, session ID field, tool-call representation, and token reporting before implementing the stream parser"
feature: adapter-codex
tags: [spike, adapter, codex, openai, jsonl, schema, prerequisite]
---

## Given
- The Codex CLI (`@openai/codex` v0.140.0+) is installed and available on PATH (`codex --version` prints a version).
- The CLI is authenticated (either via `OPENAI_API_KEY` env or prior interactive ChatGPT sign-in).
- A git repository exists as a working directory (Codex requires it by default unless `--skip-git-repo-check` is passed).
- The contributor has a test prompt that triggers at least one tool call (e.g., `"Create a file hello.txt with 'Hello World' and then read its contents"`).

## When
- The contributor runs:
  ```bash
  codex exec "Create a file hello.txt with 'Hello World' and then read its contents" \
    --json \
    --dangerously-bypass-approvals-and-sandbox \
    2>&1 | tee codex-capture.jsonl
  ```
- The contributor runs a second command using resume to verify round-trip:
  ```bash
  codex exec resume <SESSION_ID_FROM_FIRST_RUN> "Now delete hello.txt" \
    --json \
    --dangerously-bypass-approvals-and-sandbox \
    2>&1 | tee codex-resume-capture.jsonl
  ```

## Then
The spike produces documentation (as a comment on issue #41 or a file in `packages/adapter-codex/docs/`) answering:

1. **JSONL event schema** — What event types are emitted? Expected candidates based on Claude Code analogy:
   - Session/init event (carries session ID, model)
   - Message events (user prompt, assistant responses)
   - Tool-call events (which tools? `shell`, `file_write`, `apply_patch`?)
   - Tool-result events
   - Final/result event (stop reason, usage, cost)
   Document the exact JSON shape of each event type observed.

2. **Session ID surfacing** — Which event and which field contains the resumable session identifier? (e.g., `session_id`, `thread_id`, `uuid`)

3. **Tool-call representation** — How does Codex encode tool invocations?
   - Field name for tool name (e.g., `name`, `tool`)
   - Field name for input (e.g., `input`, `args`, `parameters`)
   - How are results paired back? (e.g., by `id`, by sequence)

4. **Token usage** — Does the JSONL stream report input/output tokens? If so, which event and which fields? (e.g., `usage.input_tokens`, `usage.output_tokens`)

5. **Auth verification** — Confirm headless API-key mode (`OPENAI_API_KEY` env) works without browser auth. Document any observed differences.

6. **Resume round-trip** — Confirm `codex exec resume <id> "<prompt>" --json` carries prior conversation context and emits a coherent delta. Document any caveats (e.g., does the resumed stream re-emit prior turns or only deltas?).

7. **Git repo handling** — Verify behavior with and without `--skip-git-repo-check`. Does Codex refuse to edit files in non-git directories?

## Deliverables
- A `packages/adapter-codex/tests/fixtures/codex-stream.success.jsonl` file containing a captured successful run.
- A `packages/adapter-codex/tests/fixtures/codex-stream.resume.jsonl` file containing a captured resume run.
- A document (issue comment or `packages/adapter-codex/docs/jsonl-schema.md`) with the schema analysis.
- These artifacts unblock the implementation of `stream-parser.ts` and the full adapter behavior specs.

## Notes
This is a **spike** (research task), not a code implementation spec. The outcome informs subsequent specs:
- `adapter-codex-stream-parser.md` — cannot be written until the JSONL schema is known
- `adapter-codex-create-session.md` — depends on knowing how session ID is surfaced
- `adapter-codex-send.md` — depends on knowing how tool calls and tokens are reported
