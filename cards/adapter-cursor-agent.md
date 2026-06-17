---
id: adapter-cursor-agent
title: "Cursor Agent Adapter"
sources:
  - packages/adapter-cursor-agent/src/adapter.ts
  - packages/adapter-cursor-agent/src/stream-parser.ts
  - packages/adapter-cursor-agent/src/spawn.ts
  - packages/adapter-cursor-agent/src/types.ts
tags: [architecture, adapter, cursor-agent, agent]
created: 2026-06-17
updated: 2026-06-17
---

# Cursor Agent Adapter

`@sumeru/adapter-cursor-agent` implements the `Adapter` contract from `@sumeru/core` by shelling out to the `cursor-agent` CLI with `--print --output-format stream-json --trust --force --workspace <cwd>`. Like the Claude Code adapter, cursor-agent has no stable on-disk session DB — all turn history is cached in-memory for the adapter's lifetime.

## Adapter Identity

```typescript
name: "cursor-agent"
capabilities: { resume: true, streaming: false }
```

## Factory Function

```typescript
function createCursorAgentAdapter(options?: Partial<CursorAgentAdapterOptions>): Adapter
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `cursorAgentBin` | `"cursor-agent"` | Path to cursor-agent executable |
| `model` | `null` (cursor-agent default) | `--model` value for all spawns |
| `cwd` | `process.cwd()` | Working directory, passed as `--workspace <path>` |
| `createSessionTimeoutMs` | 300,000 (5 min) | Timeout for createSession |
| `sendTimeoutMs` | 600,000 (10 min) | Timeout for send |
| `spawnFn` | `defaultSpawn` | Test seam for child_process.spawn |
| `permissionMode` | `"force"` | Permission bypass flag: `"force"` or `"yolo"` |
| `sandbox` | `null` | `--sandbox` value; `null` means flag is omitted |

## createSession

Spawns:
```
cursor-agent -p "<initialQuery>" --print --output-format stream-json
  --trust --force --workspace <cwd> [--model <m>]
```

Parses the NDJSON output for the `system` line (subtype `init`) containing `session_id`. The initial turns are rewritten to start at index 0 and cached in-memory.

Returns a `NativeSessionRef` with meta: `{ cwd, model, createdAt, subtype }`.

## send

Spawns:
```
cursor-agent -p "<content>" --print --output-format stream-json
  --trust --force --resume <nativeId> --workspace <cwd> [--model <m>]
```

### Index Rewriting

Same pattern as the Claude Code adapter — per-run indices are rewritten to be globally monotonic across the session lifetime.

### Per-nativeId Send Mutex

Promise-chain-based lock ensures serial execution per session. Prevents concurrent `send` calls from racing on the in-memory cache.

## close

Logical close only — adds `nativeId` to a `Set<string>`. No cursor-agent-side notification, no cache eviction. Subsequent `send` calls throw immediately. `getTurns` still works after close.

## getTurns

Returns a defensive copy (`[...cached]`) of the in-memory turn cache for the given `nativeId`. Returns `[]` for unknown sessions.

## NDJSON Stream Parser (`parseStreamJson`)

Parses cursor-agent's `--output-format stream-json` output. Each line is a JSON object with a `type` field:

| Line Type | Description |
|-----------|-------------|
| `system` (subtype: `init`) | First line; carries `session_id`, `model`, `cwd` |
| `user` | User prompt; `message.content` array with text segments |
| `thinking` | Reasoning text; **discarded entirely** — NOT emitted as turns |
| `assistant` | Model response; `message.content` array with text segments |
| `tool_call` (subtype: `started`) | Tool invocation; carries `call_id`, tool args |
| `tool_call` (subtype: `completed`) | Tool result; carries `call_id`, result payload |
| `result` (subtype: `success`) | Final summary (duration, usage, request_id) |

### Key Difference from Claude Code Parser

Claude Code embeds `tool_use` segments in assistant message content and returns results as `tool_result` user lines. Cursor-agent uses **separate `tool_call` events** with explicit `started`/`completed` subtypes:

- `tool_call` (started) → creates a `ToolCall` entry, associates with most recent assistant turn
- `tool_call` (completed) → fills in `output` and `exitCode` on the matching `ToolCall` by `call_id`

Supported tool call types: `editToolCall`, `shellToolCall`. Shell tool calls extract `exitCode` from the result; edit tool calls always have `exitCode: null`.

### Key Parser Behaviors

- **Thinking lines** → completely discarded (not emitted as turns)
- **Unmatched `started`** → ToolCall remains with `output: null`
- **Unmatched `completed`** → silently dropped
- **Malformed lines** → silently skipped (tolerant parsing)
- **No session_id and no result line** → returns `null` (hard error for caller)
- **Session_id but no result line** → synthesized "incomplete" result

### Parsed Result Type

```typescript
type CursorAgentParsedResult = {
  type: string;
  subtype: "success" | "incomplete";
  result: string;
  sessionId: string;
  numTurns: number;
  durationMs: number;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  turns: Turn[];
};
```

## Error Handling

Prioritized error detection:

| Check Order | Condition | Error |
|-------------|-----------|-------|
| 1 | stderr matches CURSOR_API_KEY/auth patterns | `cursor-agent exited with code <N>: cursor-agent API key error...` |
| 2 | stderr matches trust patterns | `cursor-agent exited with code <N>: cursor-agent requires --trust...` |
| 3 | stderr matches "not found" (resume) | `cursor-agent session <id> not found: <detail>` |
| 4 | Non-zero exit code | `cursor-agent exited with code <N>: <stderr tail>` |
| 5 | Unparseable output, exit 0 | `cursor-agent returned unparseable stream-json output (bin=..., ...)` |

## Process Spawning (`defaultSpawn`)

Identical pattern to the Claude Code adapter:
- Passes `cwd` to child_process.spawn options
- Explicitly sets `env: process.env` (must include `CURSOR_API_KEY`) and `shell: false`
- Timeout strategy: SIGTERM → 5s grace → SIGKILL
- Timer is `unref()`'d

## Architectural Similarities to Claude Code Adapter

| Aspect | Cursor Agent | Claude Code |
|--------|-------------|-------------|
| Turn storage | In-memory Map (adapter-owned) | In-memory Map (adapter-owned) |
| History on restart | Lost (per-process) | Lost (per-process) |
| Index numbering | Rewritten for monotonicity | Rewritten for monotonicity |
| Tool result handling | Separate `tool_call` events matched by `call_id` | `tool_result` user lines folded into ToolCall.output |
| CWD | `--workspace <path>` flag | spawn `cwd` option |
| Permission bypass | `--trust --force` (or `--yolo`) | `--dangerously-skip-permissions` |
