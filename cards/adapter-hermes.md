---
id: adapter-hermes
title: "Hermes Adapter"
sources:
  - packages/adapter-hermes/src/adapter.ts
  - packages/adapter-hermes/src/spawn.ts
  - packages/adapter-hermes/src/types.ts
tags: [architecture, adapter, hermes, session]
created: 2026-06-15
updated: 2026-06-23
---

# Hermes Adapter

`@sumeru/adapter-hermes` implements the `Adapter` contract by spawning `hermes chat -q ...`, reading turn history (JSONL-first with DB fallback via injected readers), and emitting send results as async `SendEvent` streams.

## Identity and Storage Model

- `name`: `hermes`
- Resume model: `--resume <nativeId>`
- Turn history source: read from external Hermes session storage (via `jsonlReader` then `turnsReader`), not in-memory cache
- Streaming behavior: `send()` returns `AsyncIterable<SendEvent>` but emits after spawn/read cycle (not incremental line streaming)

## Factory Options

`createHermesAdapter(options)` supports:

- `hermesBin` (default `hermes`)
- `sourceTag` (default `sumeru`)
- `cwd` (adapter fallback cwd)
- `dbPath`, `sessionsDir`
- `createSessionTimeoutMs` (default 60s)
- `sendTimeoutMs` (default 5m)
- `includeSystemTurns` (default `false`)
- `spawnFn`, `turnsReader`, `jsonlReader` (test seams)

## CWD Resolution (Per Call)

The adapter resolves cwd per invocation:

- `createSession`: non-empty `config.cwd` wins; otherwise adapter `cwd`; otherwise `process.cwd()`
- `send`: non-empty `ref.meta.cwd` wins; otherwise adapter `cwd`; otherwise `process.cwd()`

The resolved value is passed to `spawn` `cwd`, and session creation stores it in `meta.cwd` so resume uses the original session cwd.

## createSession Flow

1. Validates `config.cwd` type (`string | null`).
2. Spawns `hermes chat -q ping --pass-session-id --quiet --source <tag> [--model]` with resolved cwd.
3. Handles timeout and non-zero exits.
4. Parses session id from merged `stderr + stdout` using either `Session:` or `session_id:` line forms.
5. Validates native id shape `YYYYMMDD_HHMMSS_<hex>`.
6. Returns `NativeSessionRef` with meta including `sourceTag`, `cwd`, `model`, `createdAt`.

## send Flow and Concurrency Fix

`send(ref, content)`:

- Performs synchronous prechecks (valid ref, not closed, non-empty content).
- Serializes operations per `nativeId` via `sendLocks` promise chaining (`withRefLock`), preventing overlap/races.
- Inside lock:
  1. Reads pre-send turns (`before`) and computes high-water index.
  2. Spawns resume command in resolved send cwd.
  3. On success, reads post-send turns (`after`), computes delta (`index > highWater`).
  4. Optionally filters system turns.
  5. Emits one `turn` event per delta turn, then `done` with aggregated token usage.
- On failure/timeout/closed state/session missing, emits a single `error` event.

## close and getTurns

- `close(ref)`: logical close only; adds `nativeId` to `closedRefs`.
- `getTurns(ref)`: reads all turns through JSONL-first/fallback readers and applies optional system-turn filtering.

Close does not mutate Hermes storage or spawn a process.

## Spawn Contract

`defaultSpawn` wraps `child_process.spawn` with:

- explicit argv array (`shell: false`)
- explicit `cwd`
- timeout escalation (`SIGTERM`, then `SIGKILL` after 5s)
- result shape `{ stdout, stderr, exitCode, signal, timedOut, durationMs }`

## Error Mapping Highlights

- spawn failures: `hermes adapter failed to spawn ...`
- timeout: `createSession/send timed out ...`
- resume session missing: `hermes session <id> not found: ...`
- generic exit errors: `hermes exited with code ...`
- invalid refs: throws `close: invalid NativeSessionRef` from shared guard
