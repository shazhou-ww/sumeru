---
id: adapter-claude-code
title: "Claude Code Adapter"
sources:
  - packages/adapter-claude-code/src/adapter.ts
  - packages/adapter-claude-code/src/spawn.ts
  - packages/adapter-claude-code/src/stream-parser.ts
  - packages/adapter-claude-code/src/types.ts
tags: [architecture, adapter, claude-code, streaming]
created: 2026-06-15
updated: 2026-06-23
---

# Claude Code Adapter

`@sumeru/adapter-claude-code` implements the `Adapter` contract by spawning the `claude` CLI in `stream-json` mode and maintaining per-session turns in memory.

## Identity and Capabilities

- `name`: `"claude-code"`
- Session persistence: in-memory only (`Map<string, Turn[]>`)
- Resume support: yes (`--resume <nativeId>`)
- Streaming support: yes (`send()` yields incremental `SendEvent`s)

## Factory and Options

`createClaudeCodeAdapter(options)` resolves defaults:

- `claudeBin`: `claude`
- `maxTurns`: `90`
- `createSessionTimeoutMs`: `5m`
- `sendTimeoutMs`: `30m`
- `cwd`: optional adapter-level fallback cwd
- `spawnFn`: full-buffer spawn seam (used by `createSession`)
- `streamingSpawnFn`: incremental spawn seam (used by `send`)

## createSession Flow

`createSession(config)`:

1. Validates `config.cwd` is `string | null`.
2. Resolves model from `config.model` then adapter default.
3. Resolves cwd per call: `config.cwd` (non-empty) or adapter fallback (`options.cwd` or `process.cwd()`).
4. Spawns `claude -p ping ... --output-format stream-json --verbose --dangerously-skip-permissions --max-turns ...`.
5. Parses stdout via `parseStreamJson` and requires a non-empty `session_id`.
6. Rewrites parsed turn indices to start from 0 and stores them in cache.
7. Returns `{ nativeId, meta }` where meta includes `cwd`, model, `createdAt`, subtype.

## send Flow (Incremental Streaming)

`send(ref, content)` returns an async iterable of `SendEvent`:

- Pre-checks validate ref/content and reject closed sessions.
- A per-`nativeId` promise lock serializes concurrent sends.
- CWD/model are resolved from `ref.meta` first, then adapter defaults.
- Uses `streamingSpawnFn` so stdout is consumed line-by-line.
- Feeds lines into `parseStreamJsonIncremental`:
  - `turn` events are index-rewritten to global monotonic order and appended to cache immediately.
  - `result` line is captured for token derivation.
- Awaits process exit and emits:
  - `error` on spawn/read/exit/timeout/non-zero exit failures.
  - `done` with `durationMs` and optional tokens on success.

This is a true incremental path: turns are emitted before process exit, not only after full stdout capture.

## close and getTurns

- `close(ref)`: logical close only; adds native id to a closed set.
- `getTurns(ref)`: returns a defensive copy of cached turns, `[]` if unknown.

No on-disk session DB is used; restarting the adapter loses cached history.

## Parser Behavior

`parseStreamJson` and `parseStreamJsonIncremental` interpret NDJSON `type` lines:

- `system`: captures session/model metadata.
- `assistant`: emits assistant turns with extracted tool calls.
- `user`:
  - plain text becomes a user turn,
  - `tool_result` updates pending tool-call output (no separate turn).
- `result`: captures subtype/usage summary.

Notable semantics:

- Malformed/unrecognized lines are skipped (tolerant parse).
- Missing `result` with known `session_id` synthesizes subtype `incomplete`.
- Unknown subtype values are coerced to `incomplete`.
- Incremental parser can emit `meta`, `turn`, and `result` events.

## Spawning and Timeouts

`defaultSpawn` and `defaultStreamingSpawn` use `child_process.spawn` with:

- `shell: false`
- explicit `cwd`
- timeout escalation: `SIGTERM`, then `SIGKILL` after 5s grace
- duration and timeout metadata surfaced to adapter logic

## Error Mapping

`makeUnparseableOrExitError` prioritizes:

1. not-logged-in stderr patterns
2. API key/auth stderr patterns
3. resume session not found patterns
4. generic non-zero exits
5. unparseable stream-json output (including stdout/stderr snippets)

This keeps operator-facing failures specific before falling back to generic parse/exit errors.
