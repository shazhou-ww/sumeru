---
id: adapter-cursor-agent
title: "Cursor Agent Adapter"
sources:
  - packages/adapter-cursor-agent/src/adapter.ts
  - packages/adapter-cursor-agent/src/spawn.ts
  - packages/adapter-cursor-agent/src/stream-parser.ts
  - packages/adapter-cursor-agent/src/types.ts
  - packages/cli/src/build-adapters.ts
tags: [architecture, adapter, cursor-agent, streaming]
created: 2026-06-17
updated: 2026-06-23
---

# Cursor Agent Adapter

`@sumeru/adapter-cursor-agent` implements the core `Adapter` interface by spawning `cursor-agent` with `--output-format stream-json`, parsing NDJSON events into `Turn`s, and caching turns in memory per native session id.

## Identity and Capability

- `name`: `cursor-agent`
- Session history store: in-memory `Map<string, Turn[]>`
- Resume support: yes (`--resume <nativeId>`)
- Streaming send path: yes (`send()` yields incremental `SendEvent`s)

History is process-local and is not rehydrated from disk.

## Factory Options

`createCursorAgentAdapter(options)` supports:

- `cursorAgentBin` (default `cursor-agent`)
- `model` (default `null`)
- `cwd` (adapter fallback cwd, default `process.cwd()`)
- `createSessionTimeoutMs` (default 5m)
- `sendTimeoutMs` (default 10m)
- `spawnFn` / `streamingSpawnFn` test seams
- `permissionMode`: `force` or `yolo` (default `force`)
- `sandbox`: `enabled` | `disabled` | `null`

Argument construction always includes `--print --output-format stream-json --trust --workspace <cwd>`, then:

- `--force` when `permissionMode = force`
- `--yolo` when `permissionMode = yolo`
- `--sandbox <value>` when configured
- `--resume <id>` on send
- `--model <m>` when model is non-null

## createSession Flow

`createSession(config)`:

1. Resolves model from `config.model` then adapter default.
2. Resolves cwd from `config.cwd` then adapter fallback.
3. Spawns `cursor-agent -p ping ...` with resolved cwd.
4. Parses stdout via `parseStreamJson`.
5. Requires a non-empty parsed `sessionId`.
6. Rewrites parsed turn indices to start at 0.
7. Caches rewritten turns and returns `NativeSessionRef` with meta (`cwd`, `model`, `createdAt`, `subtype`).

## send Flow (Incremental Streaming)

`send(ref, content)`:

- Performs sync prechecks (`ref`, closed-state, non-empty content).
- Serializes per-session sends via a promise-chain lock (`sendLocks`).
- Re-resolves model/cwd from `ref.meta` first, then adapter defaults.
- Uses `streamingSpawnFn` for line-by-line stdout handling.
- Parses lines through `parseStreamJsonIncremental`.
- Emits each new parsed turn immediately as `{ type: "turn", turn }`.
- Rewrites emitted turn indices to globally monotonic sequence across the session.
- Appends turns to cache as they stream.
- Emits `{ type: "done", durationMs, tokens }` on success, or `{ type: "error", error }` on failure.

Token derivation for `done` reads `resultLine.usage.inputTokens` and `outputTokens`; returns `null` if both are zero.

## close and getTurns

- `close(ref)`: logical close only; marks session id closed.
- `getTurns(ref)`: defensive copy of cached turns; returns empty list for unknown refs.

No external close call is made to cursor-agent.

## Parser Semantics

`parseStreamJson` and `parseStreamJsonIncremental` consume NDJSON events:

- `system`: captures `session_id` and `model`
- `assistant`: emits assistant text turns
- `user`: emits user text turns
- `thinking`: ignored (no turns)
- `tool_call` subtype `started`: creates a `ToolCall`, attaches it to latest assistant turn (or creates empty assistant turn if none)
- `tool_call` subtype `completed`: fills `ToolCall.output`/`exitCode` by `call_id`
- `result`: stores summary and usage fields

Details:

- Supported tool call names are inferred from keys (`editToolCall`, `shellToolCall`, fallback detection).
- Malformed or unknown lines are skipped.
- If no result line but session id exists, subtype is synthesized as `incomplete`.
- Incremental parser yields only newly created turns; tool-call mutations happen via shared references and do not create extra events.

## Spawn and Timeout Behavior

Both spawn implementations (`defaultSpawn`, `defaultStreamingSpawn`) use `child_process.spawn` with `shell: false`, explicit `cwd`, and timeout escalation (`SIGTERM`, then `SIGKILL` after 5 seconds).

## Error Mapping

`makeUnparseableOrExitError` prioritizes:

1. API key/auth patterns (`CURSOR_API_KEY`, authentication/unauthorized)
2. trust requirement patterns (mapped to explicit trust error)
3. resume session-not-found patterns
4. generic non-zero exits
5. unparseable stream-json fallback with stdout/stderr snippets

## CLI Integration

`packages/cli/src/build-adapters.ts` registers `"cursor-agent"` in `DEFAULT_ADAPTER_FACTORIES` and forwards each gateway's `config` blob directly into `createCursorAgentAdapter`, enabling server factory wiring without CLI-side option shaping.
