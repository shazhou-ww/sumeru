---
id: adapter-claude-code
title: "Claude Code Adapter"
sources:
  - packages/adapter-claude-code/src/adapter.ts
  - packages/adapter-claude-code/src/stream-parser.ts
  - packages/adapter-claude-code/src/spawn.ts
  - packages/adapter-claude-code/src/types.ts
tags: [architecture, adapter, claude-code, agent]
created: 2026-06-15
updated: 2026-06-15
---

# Claude Code Adapter

`@sumeru/adapter-claude-code` implements the `Adapter` contract from `@sumeru/core` by shelling out to the `claude` CLI with `--output-format stream-json --verbose`. Unlike the Hermes adapter, Claude Code has no stable on-disk session DB — all turn history is cached in-memory for the adapter's lifetime.

## Adapter Identity

```typescript
name: "claude-code"
capabilities: { resume: true, streaming: false }
```

## Factory Function

```typescript
function createClaudeCodeAdapter(options?: Partial<ClaudeCodeAdapterOptions>): Adapter
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `claudeBin` | `"claude"` | Path to claude executable |
| `model` | `null` (CC default) | `--model` value for all spawns |
| `maxTurns` | `90` | `--max-turns` flag value |
| `cwd` | `process.cwd()` | Working directory for spawned processes |
| `createSessionTimeoutMs` | 300,000 (5 min) | Timeout for createSession |
| `sendTimeoutMs` | 600,000 (10 min) | Timeout for send |
| `spawnFn` | `defaultSpawn` | Test seam for child_process.spawn |

## createSession

Spawns:
```
claude -p "<initialQuery>" --output-format stream-json --verbose
  --dangerously-skip-permissions --max-turns <n> [--model <m>]
```

Parses the NDJSON output for the `system` line containing `session_id`. The initial turns are rewritten to start at index 0 and cached in-memory.

Returns a `NativeSessionRef` with meta: `{ cwd, model, createdAt, subtype }`.

## send

Spawns:
```
claude -p "<content>" --resume <nativeId> --output-format stream-json
  --verbose --dangerously-skip-permissions --max-turns <n> [--model <m>]
```

### Index Rewriting

Claude Code produces per-run turn indices starting at 0. The adapter rewrites them to be **globally monotonic** across the session lifetime:

```typescript
function rewriteIndices(turns: Turn[], highWater: number): Turn[] {
  let nextIndex = highWater + 1;
  return turns.map(turn => ({ ...turn, index: nextIndex++ }));
}
```

On each `send`:
1. Read cached turns, compute high-water mark (max index, or -1 if empty)
2. Spawn `claude --resume <id>`
3. Parse the NDJSON output into turns
4. Rewrite turn indices starting from `highWater + 1`
5. Append delta turns to the in-memory cache
6. Return the delta as `AgentResponse.turns`

### Per-nativeId Send Mutex

Same pattern as the Hermes adapter — promise-chain-based lock ensures serial execution per session. Prevents concurrent `send` calls from racing on the in-memory cache.

## close

Logical close only — adds `nativeId` to a `Set<string>`. No CC-side notification, no cache eviction. Subsequent `send` calls throw immediately.

## getTurns

Returns a defensive copy (`[...cached]`) of the in-memory turn cache for the given `nativeId`. Returns `[]` for unknown sessions.

## NDJSON Stream Parser (`parseStreamJson`)

Parses Claude Code's `--output-format stream-json --verbose` output. Each line is a JSON object with a `type` field:

| Line Type | Description |
|-----------|-------------|
| `system` | First line; carries `session_id` and `model` |
| `assistant` | Model response; `content` array with `text` and `tool_use` segments |
| `user` | User input or `tool_result` reply |
| `result` | Final summary (subtype, usage, stop_reason, cost, duration) |

### Key Parser Behaviors

- **User prompt** → emitted as `role: "user"` Turn
- **Tool results** → folded into the matching assistant turn's `ToolCall.output` (NOT a separate turn)
- **tool_use segments** → extracted as `ToolCall[]` with `output: null`, `durationMs: null`
- **Malformed lines** → silently skipped (tolerant parsing)
- **No session_id and no result line** → returns `null` (hard error for caller)
- **Session_id but no result line** → synthesized "incomplete" result

### Parsed Result Type

```typescript
type ClaudeCodeParsedResult = {
  type: string;
  subtype: "success" | "error_max_turns" | "error_budget" | "incomplete";
  result: string;                    // last assistant content
  sessionId: string;
  numTurns: number;
  totalCostUsd: number;
  durationMs: number;
  model: string;
  stopReason: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  turns: Turn[];
};
```

### Token Derivation

`deriveTokens` returns `null` when both input and output are 0 AND subtype is "incomplete" (stream was truncated — no meaningful usage data). Otherwise returns `{ input, output }`.

## Process Spawning (`defaultSpawn`)

Same pattern as the Hermes adapter with one addition:
- Passes `cwd` to child_process.spawn options
- Explicitly sets `env: process.env` and `shell: false`
- Same timeout strategy: SIGTERM → 5s grace → SIGKILL
- Timer is `unref()`'d

## Error Handling

Prioritized error detection:

| Check Order | Condition | Error |
|-------------|-----------|-------|
| 1 | stderr matches "not logged in" | `claude exited with code <N>: claude code is not logged in...` |
| 2 | stderr matches API key patterns | `claude exited with code <N>: claude code API key error...` |
| 3 | stderr matches "not found" (resume) | `claude code session <id> not found: <detail>` |
| 4 | Non-zero exit code | `claude exited with code <N>: <stderr tail>` |
| 5 | Unparseable output, exit 0 | `claude code returned unparseable stream-json output (bin=..., ...)` |

API key patterns detected: `/invalid api key/i`, `/ANTHROPIC_API_KEY/i`, `/authentication/i`, `/unauthorized/i`.

## Architectural Differences from Hermes Adapter

| Aspect | Hermes | Claude Code |
|--------|--------|-------------|
| Turn storage | JSONL files + SQLite DB (external) | In-memory Map (adapter-owned) |
| History on restart | Preserved (disk-backed) | Lost (per-process) |
| Index numbering | Native from source | Rewritten for monotonicity |
| Tool result handling | Separate turn rows | Folded into ToolCall.output |
| CWD | Not passed to spawn | Explicit per-spawn cwd |
