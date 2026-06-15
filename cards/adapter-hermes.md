---
id: adapter-hermes
title: "Hermes Adapter"
sources:
  - packages/adapter-hermes/src/adapter.ts
  - packages/adapter-hermes/src/jsonl.ts
  - packages/adapter-hermes/src/db.ts
  - packages/adapter-hermes/src/spawn.ts
  - packages/adapter-hermes/src/types.ts
tags: [architecture, adapter, hermes, agent]
created: 2026-06-15
updated: 2026-06-15
---

# Hermes Adapter

`@sumeru/adapter-hermes` implements the `Adapter` contract from `@sumeru/core` by shelling out to the `hermes` CLI. It manages session creation, message sending, and turn history reading with a JSONL-first strategy and SQLite fallback.

## Adapter Identity

```typescript
name: "hermes"
capabilities: { resume: true, streaming: false }
```

## Factory Function

```typescript
function createHermesAdapter(options?: Partial<HermesAdapterOptions>): Adapter
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `hermesBin` | `"hermes"` | Path to hermes executable |
| `sourceTag` | `"sumeru"` | `--source` value for hermes invocations |
| `dbPath` | `~/.hermes/state.db` | SQLite session DB path |
| `sessionsDir` | `~/.hermes/sessions` | JSONL per-session directory |
| `createSessionTimeoutMs` | 60,000 | Timeout for createSession |
| `sendTimeoutMs` | 300,000 (5 min) | Timeout for send |
| `includeSystemTurns` | `false` | Include system-role turns in output |
| `spawnFn` | `defaultSpawn` | Test seam for child_process.spawn |
| `turnsReader` | `readTurnsFromDb` | Test seam for SQLite reader |
| `jsonlReader` | `readTurnsFromJsonl` | Test seam for JSONL reader |

## createSession

Spawns `hermes chat -q "<initialQuery>" --pass-session-id --quiet --source <tag>` and parses the session ID from the output.

### Session ID Parsing

Hermes v0.15.1+ prints `session_id: <id>` to **stderr**. Older versions print `Session: <id>` to stdout. The adapter merges `stderr + stdout` and accepts either format via regex:

```
/^(?:Session:|session_id:)\s+(\S+)\s*$/m
```

The parsed ID must match the hermes format: `YYYYMMDD_HHMMSS_<hex>`.

### Allowed Config Keys

Only these config fields are forwarded as CLI flags:
`model`, `provider`, `toolsets`, `skills`, `worktree`, `acceptHooks`, `yolo`, `maxTurns`, `ignoreUserConfig`, `ignoreRules`

Keys are converted to kebab-case flags. Booleans become flag-only (`--yolo`), arrays repeat the flag (`--toolsets a --toolsets b`).

## send

Sends a message via `hermes chat -q "<content>" --resume <nativeId>` and returns the **delta** turns produced.

### Delta Computation

1. Read all turns before the send (high-water mark = max index)
2. Spawn hermes with `--resume`
3. Read all turns after the send
4. Filter to turns with `index > highWater`
5. Optionally exclude system turns

### Per-nativeId Send Mutex

A `withRefLock(nativeId, fn)` ensures only one concurrent `send` runs per session. Subsequent sends queue and execute serially. This prevents race conditions when the same session is accessed from multiple request paths.

Implementation: a `Map<nativeId, Promise>` chains promises; each `send` awaits the previous before executing.

## close

Logical close only — adds the `nativeId` to a per-instance `Set<string>`. No DB mutation, no process spawn. Subsequent `send` calls throw immediately.

## getTurns

Reads the full turn history using the JSONL-first strategy (see below). Filters system turns unless `includeSystemTurns` is set.

## Turn Reading Strategy

### JSONL-First (hermes v0.15.1+)

Source: `<sessionsDir>/<nativeId>.jsonl`

Each line is a JSON object. The first `role: "session_meta"` line is metadata (skipped). Subsequent lines are turns (`user`, `assistant`, `system`, `tool`).

Behavior:
- File not found → return `null` (fall through to DB)
- File exists, all lines fail to parse → return `null` (fall through)
- File exists, some lines parse → skip bad lines silently, return valid turns
- Empty file → return `[]` (session created, no turns yet)

Tool calls are parsed from the uwf shape: `[{function: {name, arguments: "<json>"}}]`

### SQLite Fallback

Source: `~/.hermes/state.db` (read-only via `node:sqlite`)

Supports two schemas detected at read time:

| Schema | Tables | Key Columns |
|--------|--------|-------------|
| **v1** (legacy) | `messages` | `session_id, idx, role, content, timestamp, tool_calls_json, tokens_in, tokens_out` |
| **v2** (uwf-shaped) | `sessions` + `messages` | `sessions(id, model, started_at)`, `messages(session_id, role, content, reasoning, tool_calls)` |

v2 is preferred when both tables match. v1 is the fallback. Mismatches throw with a diagnostic error naming the missing column.

### Role Normalization

Both readers normalize `tool` → `assistant` for the `@sumeru/core` Turn shape.

### Timestamp Normalization

- Numeric → `new Date(n).toISOString()`
- String ending in `Z` → passthrough
- String without timezone → append `Z` and parse
- Unparseable → epoch (JSONL) or current time (DB v1)

## Process Spawning (`defaultSpawn`)

Wraps `child_process.spawn` with:
- Explicit `args` array (no shell — safe for special characters)
- `stdio: ["ignore", "pipe", "pipe"]`
- Configurable timeout → `SIGTERM`, then `SIGKILL` after 5s grace
- Returns `{ stdout, stderr, exitCode, signal, timedOut, durationMs }`
- Timer is `unref()`'d to not block process exit

## Error Handling

| Condition | Error Message Pattern |
|-----------|-----------------------|
| Spawn failure | `hermes adapter failed to spawn '<bin>': <cause>` |
| Create timeout | `createSession timed out after <N>ms` |
| Non-zero exit | `hermes exited with code <N>: <stderr tail>` |
| ID parse failure | `failed to parse Hermes session id from stderr+stdout` |
| ID format mismatch | `failed to parse Hermes session id (got '...', expected ...)` |
| Send to closed session | `hermes session <id> is closed` |
| Session not found (send) | `hermes session <id> not found: <detail>` |
| DB not found | `hermes session DB not found at <path>` |
| Schema mismatch | `hermes session DB schema mismatch: missing column '...'` |
