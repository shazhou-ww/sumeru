# Changelog

## 0.2.0 — 2026-06-26

- Add OpenAI Codex CLI adapter (@sumeru/adapter-codex) with support for session resume via `codex exec resume`. The adapter spawns `codex exec --json` for structured JSONL output parsing, with configurable flags for `--dangerously-bypass-approvals-and-sandbox` and `--skip-git-repo-check` for unattended operation.
- Replace fabricated Codex JSONL fixtures and stream parser with real Codex CLI v0.141.0 schema
  
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
- Implement true incremental streaming for all NDJSON adapters (Fixes #77)
  
  Add `defaultStreamingSpawn` (returns `{lines, waitForExit()}` synchronously) and `parseStreamJsonIncremental` / `parseCodexJsonIncremental` async generators. Rewrite `send()` to yield turn events as each line is parsed from stdout — before the child process exits — with immediate turnsCache updates. Tool-result events fill in `ToolCall.output` on previously-yielded Turn objects via reference sharing.
- Add a `suspend` terminal event to the adapter send protocol (RFC #95 Phase 1).
  
  `@sumeru/core` `SendEvent` gains a fourth, terminal variant
  `{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }`,
  a peer of `done`/`error`. On a send timeout, all four adapters
  (claude-code, codex, cursor-agent, hermes) now yield this `suspend` event —
  carrying the agent's `nativeId` and the wall-clock `elapsedMs` — instead of an
  `error`, then return through the existing close path. The timed-out process is
  still SIGKILLed; `suspend` only records the checkpoint for a future resume
  (Phase 2). The server SSE stream emits a terminal `event: suspend` frame with a
  `{ type: "@sumeru/suspend", value: { reason, nativeId, elapsedMs } }` envelope
  (symmetric to `@sumeru/error`), then closes and returns the session to `idle`.
  A timeout is now conveyed only as `event: suspend`, never as `event: error`.
- Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

## 1.0.0 — 2026-06-26

- Add OpenAI Codex CLI adapter (@sumeru/adapter-codex) with support for session resume via `codex exec resume`. The adapter spawns `codex exec --json` for structured JSONL output parsing, with configurable flags for `--dangerously-bypass-approvals-and-sandbox` and `--skip-git-repo-check` for unattended operation.
- Replace fabricated Codex JSONL fixtures and stream parser with real Codex CLI v0.141.0 schema
  
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
- Implement true incremental streaming for all NDJSON adapters (Fixes #77)
  
  Add `defaultStreamingSpawn` (returns `{lines, waitForExit()}` synchronously) and `parseStreamJsonIncremental` / `parseCodexJsonIncremental` async generators. Rewrite `send()` to yield turn events as each line is parsed from stdout — before the child process exits — with immediate turnsCache updates. Tool-result events fill in `ToolCall.output` on previously-yielded Turn objects via reference sharing.
- Add a `suspend` terminal event to the adapter send protocol (RFC #95 Phase 1).
  
  `@sumeru/core` `SendEvent` gains a fourth, terminal variant
  `{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }`,
  a peer of `done`/`error`. On a send timeout, all four adapters
  (claude-code, codex, cursor-agent, hermes) now yield this `suspend` event —
  carrying the agent's `nativeId` and the wall-clock `elapsedMs` — instead of an
  `error`, then return through the existing close path. The timed-out process is
  still SIGKILLed; `suspend` only records the checkpoint for a future resume
  (Phase 2). The server SSE stream emits a terminal `event: suspend` frame with a
  `{ type: "@sumeru/suspend", value: { reason, nativeId, elapsedMs } }` envelope
  (symmetric to `@sumeru/error`), then closes and returns the session to `idle`.
  A timeout is now conveyed only as `event: suspend`, never as `event: error`.
- Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

