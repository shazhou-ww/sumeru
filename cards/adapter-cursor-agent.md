---
id: adapter-cursor-agent
title: "Cursor Agent Adapter"
sources:
  - packages/adapter-cursor-agent/src/adapter.ts
  - packages/adapter-cursor-agent/src/stream-parser.ts
  - packages/adapter-cursor-agent/src/spawn.ts
  - packages/adapter-cursor-agent/src/types.ts
  - packages/adapter-cursor-agent/src/index.ts
tags: [architecture, adapter, cursor-agent, agent]
created: 2026-06-17
updated: 2026-07-01
---

# Cursor Agent Adapter

`@sumeru/adapter-cursor-agent` implements the `AdapterImpl` contract from `@sumeru/adapter-core` by shelling out to the `cursor-agent` CLI with `--print --output-format stream-json --trust --force --workspace <cwd>` and parsing the resulting NDJSON stream incrementally into `TurnValue` items. It follows the same v3 architecture as the Claude Code adapter: `init(config)` → `handle(message): AsyncGenerator<TurnValue, DoneValue>` → `getNativeId()`.

## Adapter Contract (v3 — `AdapterImpl`)

```typescript
type AdapterImpl = {
	init(config: AdapterInitConfig): Promise<void>;
	handle(message: AdapterInboxMessage): AsyncGenerator<AdapterHandleYield, DoneValue>;
	getNativeId?: () => string | null;
};
```

The factory:

```typescript
function createCursorAgentAdapter(options?: Partial<CursorAgentOptions>): AdapterImpl
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `cursorAgentBin` | `"cursor-agent"` | Path to cursor-agent executable |
| `model` | `null` (cursor-agent default) | `--model` value for all spawns; overridden by `init` config model name when non-empty |
| `sendTimeoutMs` | 600,000 (10 min) | Wall-clock timeout for a single `handle()` spawn |
| `streamingSpawnFn` | `defaultStreamingSpawn` | Test seam for the streaming spawn |
| `homeDir` | `process.env.HOME ?? process.cwd()` | Where init artifacts (`.cursorrules`, skills) are written |
| `permissionMode` | `"force"` | Permission bypass flag: `"force"` → `--force`, `"yolo"` → `--yolo` |
| `sandbox` | `null` | `--sandbox` value; `null` means flag is omitted |

## init

Stores the `AdapterInitConfig` in the adapter closure and writes init artifacts to the resolved home directory:

- `.cursorrules` ← `config.instructions`
- `.cursor/skills/<name>/SKILL.md` ← each skill's content

## handle

Resolves the working directory from `message.project` (falling back to `homeDir`). When the per-message cwd differs from `homeDir`, init artifacts are re-written into the cwd so cursor-agent picks up the latest instructions.

Spawns (via `defaultStreamingSpawn`):

```
cursor-agent -p "<content>" --print --output-format stream-json
  --trust --force [--yolo] [--resume <sessionId>] [--model <m>]
  [--sandbox <v>] --workspace <cwd>
```

The stdout is consumed as an `AsyncIterable<string>` of NDJSON lines via `parseStreamJsonIncremental`, which yields `StreamParseEvent`s:

- `meta` → captures the cursor-agent `session_id` (exposed via `getNativeId()`)
- `turn` → re-indexed with a globally monotonic counter and yielded to the host
- `result` → captured as the final `result` line

After the stream drains, `handle` awaits `waitForExit()` and, on a clean exit, returns `doneValueFromResultLine(resultLine)` — a `DoneValue` of `{ summary, tokenUsage: { input, output, cached } }`.

### Per-instance Handle Mutex

A promise-chain lock serializes `handle()` invocations on a single adapter instance, preventing concurrent spawns from racing on the shared `sessionId`/turn-index state.

## getNativeId

Returns the cursor-agent `session_id` captured from the `system` (subtype `init`) line, or `null` before the first `handle()` completes. The host uses this for timeout suspend/resume: a subsequent `handle()` passes `--resume <nativeId>` so cursor-agent continues the same conversation.

## NDJSON Stream Parser

`parseStreamJsonIncremental(lines)` and the batch `parseStreamJson(stdout)` parse cursor-agent's `--output-format stream-json` output. Each line is a JSON object with a `type` field:

| Line Type | Description |
|-----------|-------------|
| `system` (subtype: `init`) | First line; carries `session_id`, `model`, `cwd` |
| `user` | User prompt; `message.content` array with text segments |
| `thinking` | Reasoning text; **discarded entirely** — NOT emitted as turns |
| `assistant` | Model response; `message.content` array with text segments |
| `tool_call` (subtype: `started`) | Tool invocation; carries `call_id`, tool args |
| `tool_call` (subtype: `completed`) | Tool result; carries `call_id`, result payload |
| `result` (subtype: `success`) | Final summary (`result`, `duration_ms`, `usage`) |

### Key Difference from Claude Code Parser

Claude Code embeds `tool_use` segments in assistant message content and returns results as `tool_result` user lines. Cursor-agent uses **separate `tool_call` events** with explicit `started`/`completed` subtypes:

- `tool_call` (started) → creates a `WireToolCall` (`id=call_id`, `tool`, `input=args`, `output=null`), associates it with the most recent assistant turn's `toolCalls`
- `tool_call` (completed) → fills in `output` and `exitCode` on the matching `WireToolCall` by `call_id`, AND emits a progressive `ToolTurnValue` (#182) so the host records the tool result as an independent turn

Supported tool call types: `editToolCall`, `shellToolCall`. Shell tool calls extract `exitCode` from the result; edit tool calls always have `exitCode: null`.

### Wire Types

The parser produces v3 wire types from `@sumeru/adapter-core`:

- `AssistantTurnValue` — `{ index, role, content, timestamp, toolCalls: WireToolCall[] | null, tokens, durationMs }`
- `ToolTurnValue` — `{ index, role: "tool", name, callId, result, durationMs, timestamp }`
- `WireToolCall` — `{ id, tool, input, output, durationMs, exitCode }`
- `DoneValue` — `{ summary, tokenUsage }` (via `doneValueFromResultLine`)

### Usage Field Mapping

Cursor-agent's `usage` object uses camelCase fields (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`). `doneValueFromResultLine` maps these to the v3 `TokenUsage` shape:

| Cursor-agent | v3 `TokenUsage` |
|--------------|-----------------|
| `inputTokens` | `input` |
| `outputTokens` | `output` |
| `cacheReadTokens` | `cached` |

(`cacheWriteTokens` is not represented in the v3 `TokenUsage` shape and is dropped.)

### Key Parser Behaviors

- **Thinking lines** → completely discarded (not emitted as turns)
- **Unmatched `started`** → `WireToolCall` remains with `output: null`; no progressive tool turn
- **Unmatched `completed`** → silently dropped
- **Malformed lines** → silently skipped (tolerant parsing)
- **No session_id and no result line** → batch `parseStreamJson` returns `null`
- **Session_id but no result line** → synthesized `"incomplete"` result

### Parsed Result Type (batch path)

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
  turns: TurnValue[];
};
```

## Error Handling

On a non-zero exit, `makeExitError(SpawnExitInfo, sessionId)` prioritizes detection:

| Check Order | Condition | Error |
|-------------|-----------|-------|
| 1 | stderr matches CURSOR_API_KEY/auth patterns | `cursor-agent exited with code <N>: cursor-agent API key error...` |
| 2 | stderr matches trust patterns | `cursor-agent exited with code <N>: cursor-agent requires --trust...` |
| 3 | stderr matches "not found" (resume) | `cursor-agent session <id> not found: <detail>` |
| 4 | Non-zero exit code (fallback) | `cursor-agent exited with code <N>: <stderr tail>` |

A clean exit (code 0) with no `result` line yields `doneValueFromResultLine(null)` → `{ summary: null, tokenUsage: null }`.

## Streaming Spawn (`defaultStreamingSpawn`)

Identical pattern to the Claude Code adapter:

- Returns synchronously with an `AsyncIterable<string>` of stdout lines (via `node:readline`) plus a `waitForExit(): Promise<SpawnExitInfo>`
- Passes `cwd` to `child_process.spawn` options
- Explicitly sets `env: process.env` (must include `CURSOR_API_KEY`) and `shell: false`
- Timeout strategy: `SIGTERM` → 5 s grace → `SIGKILL`; timer is `unref()`'d

## Architectural Similarities to Claude Code Adapter

| Aspect | Cursor Agent | Claude Code |
|--------|-------------|-------------|
| Contract | `AdapterImpl` (init/handle/getNativeId) | `AdapterImpl` (init/handle/getNativeId) |
| Spawn model | Streaming (`defaultStreamingSpawn`) | Streaming (`defaultStreamingSpawn`) |
| Turn emission | `TurnValue` via `handle()` async generator | `TurnValue` via `handle()` async generator |
| Done value | `DoneValue` via `doneValueFromResultLine` | `DoneValue` via `doneValueFromResultLine` |
| Session continuity | `--resume <sessionId>` + `getNativeId()` | `--resume <sessionId>` + `getNativeId()` |
| Tool result handling | Separate `tool_call` events matched by `call_id` | `tool_result` user lines folded into `WireToolCall.output` |
| Progressive tool turn | Emitted on `tool_call` completed (#182) | Emitted on `tool_result` (#182) |
| CWD | `--workspace <path>` flag | spawn `cwd` option |
| Permission bypass | `--trust --force` (or `--yolo`) | `--dangerously-skip-permissions` |
| Init artifacts | `.cursorrules` + `.cursor/skills/<name>/SKILL.md` | `CLAUDE.md` + `.cursor/skills/<name>/SKILL.md` |
