---
id: adapter-codex
title: "Codex Adapter"
sources:
  - packages/adapter-codex/src/adapter.ts
  - packages/adapter-codex/src/spawn.ts
  - packages/adapter-codex/src/stream-parser.ts
  - packages/adapter-codex/src/types.ts
  - packages/adapter-codex/docs/jsonl-schema.md
  - packages/server/src/start.ts
  - packages/cli/src/build-adapters.ts
tags: [architecture, adapter, codex, streaming]
created: 2026-06-23
updated: 2026-06-23
---

# Codex Adapter

`@sumeru/adapter-codex` implements the `Adapter` interface by spawning the OpenAI Codex CLI (`codex exec ... --json`) and parsing JSONL events into Sumeru `Turn` objects.

## Identity and Runtime Model

- Adapter name: `codex`
- History authority: in-memory `Map<string, Turn[]>` keyed by native session id
- Resume support: yes (`codex exec resume <thread_id> <prompt> --json`)
- Streaming support: yes (`send()` is incremental and yields `SendEvent`)

The adapter owns turn history only for the process lifetime; no on-disk Codex session DB is read by Sumeru.

## Factory Options

`createCodexAdapter(options)` supports:

- `codexBin` (default `codex`)
- `model` (default `null`, no `-m` passed)
- `cwd` (default `process.cwd()` fallback)
- `createSessionTimeoutMs` (default 5 min)
- `sendTimeoutMs` (default 30 min)
- `spawnFn` / `streamingSpawnFn` (test seams)
- `dangerouslyBypassApprovals` (default `true`)
- `skipGitRepoCheck` (default `true`)

Two Codex CLI flags are enabled by default for unattended runs:

- `--dangerously-bypass-approvals-and-sandbox`
- `--skip-git-repo-check`

## Command Construction and CWD Rules

The adapter builds Codex args as:

- New session: `codex exec <prompt> --json [danger flags] -C <cwd> [-m <model>]`
- Resume: `codex exec resume <id> <prompt> --json [danger flags] [-m <model>]`

Important behavior: `-C <cwd>` is only added for non-resume mode because `codex exec resume` does not support `-C`. Resume calls still run with spawn option `cwd`, so working directory is enforced at process level.

## createSession Behavior

`createSession(config)`:

1. Resolves model from `config.model` then adapter default.
2. Resolves cwd from `config.cwd` then adapter fallback.
3. Spawns `codex exec "ping" --json ...`.
4. Parses stdout with `parseCodexJson`.
5. Requires non-empty parsed `sessionId` (from `thread.started.thread_id`).
6. Rewrites turn indices to start at 0 and caches the turns.
7. Returns `NativeSessionRef` with meta `{ cwd, model, createdAt, subtype }`.

## send Behavior (True Incremental)

`send(ref, content)` returns `AsyncIterable<SendEvent>` and uses a per-session mutex (`sendLocks`) to serialize concurrent sends for the same native id.

Inside send:

- Re-checks closed state inside lock.
- Resolves model/cwd from `ref.meta` first, then adapter defaults.
- Starts streaming spawn (`defaultStreamingSpawn` by default).
- Parses stdout line-by-line via `parseCodexJsonIncremental`.
- Emits each parsed delta turn immediately as `{ type: "turn", turn }`.
- Rewrites turn indices to stay globally monotonic across sends.
- Stores emitted turns in the in-memory cache.
- On success emits `{ type: "done", durationMs, tokens }`.
- On spawn/stream/exit/timeout problems emits `{ type: "error", error }`.

## JSONL Schema Alignment (Codex v0.141.0)

The parser aligns with the captured real schema in `docs/jsonl-schema.md`:

- `thread.started` (contains `thread_id`)
- `turn.started` (ignored)
- `item.started` (ignored for turns)
- `item.completed`
- `turn.completed` (usage)

Parsed item handling:

- `item.completed` + `agent_message` => assistant text turn
- `item.completed` + `command_execution` (status `completed`) => assistant turn with one tool call:
  - `tool: "command_execution"`
  - `input.command`
  - `output: aggregated_output`
  - `exitCode: exit_code`

Non-JSON first lines like `Reading additional input from stdin...` are intentionally skipped.

## Result and Token Semantics

- If neither session id nor result appears, parser returns `null`.
- If session id appears without `turn.completed`, parser synthesizes `subtype: "incomplete"`.
- Usage is read from `turn.completed.usage` (`input_tokens`, `output_tokens`).
- Adapter token derivation accepts alternate field names too (`inputTokens`, `outputTokens`, `prompt_tokens`, `completion_tokens`) and returns `null` when both sides are zero.

## Spawn/Timeout Model

Both spawn paths use `child_process.spawn` with:

- `shell: false`
- explicit `cwd`
- timeout escalation: `SIGTERM`, then `SIGKILL` after 5s
- captured stderr and duration metadata

## Error Mapping

`makeUnparseableOrExitError` prioritizes:

1. API key/auth patterns (`OPENAI_API_KEY`, unauthorized/authentication variants)
2. session-not-found patterns in resume mode
3. generic non-zero exits
4. unparseable JSON output fallback (includes stdout/stderr snippets)

## Server and CLI Wiring

Codex is wired as a first-class adapter in CLI factory registry:

- `packages/cli/src/build-adapters.ts` imports `createCodexAdapter`
- `DEFAULT_ADAPTER_FACTORIES` includes key `codex`
- per-gateway `config` is forwarded directly to `createCodexAdapter`

Server startup reports gateway adapter availability via logs in `startServer()` (`@sumeru/adapter-<name>`), so codex gateways appear as ready/unavailable based on registration outcome.
