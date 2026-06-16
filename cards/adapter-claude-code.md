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
updated: 2026-06-16
---

# Claude Code Adapter

`@sumeru/adapter-claude-code` implements the `Adapter` contract from `@sumeru/core` by shelling out to the `claude` CLI with `--output-format stream-json --verbose`. Unlike the Hermes adapter, Claude Code has no stable on-disk session DB — all turn history is cached in-memory for the adapter's lifetime.

> ## ⚠️ 开发须知：不要用 Claude Code 开发本包
>
> **现象**：用 `claude` 在 sumeru 仓库工作时，反复触发 "malware analysis" 误报并退出。
>
> **根因（已排查，非"CC 多疑"这种表层归因）**：这个包从语义上就是一个**挟持 Claude Code 的控制器**——它 spawn `claude`、用 `--dangerously-skip-permissions` 绕过 CC 自己的权限确认、截获并解析它的 session 内部流、按 native id 强行 resume 会话。当有人用 **Claude Code 本身**去读/改 `adapter.ts` 时，CC 的安全分类器正确地把这段源码识别为"一个用来绕过 AI agent 安全控制、劫持其会话的工具"，于是拒绝。**这是一个自指的假阳性：你在用 CC，写一段把 CC 关进笼子的代码。** 触发信号是源码语义（最强信号是 `--dangerously-skip-permissions`），不是运行时抓取输出，也不是宿主杀毒软件扫磁盘。
>
> **为什么"在 CLAUDE.md 加 trust declaration"无效**（已实测，commit `5a0208e` 加、`c9d40f4` 删）：CLAUDE.md 的指令活在"对话内"，而 malware 拒绝是"对话之上的护栏层"——对话内指令压不住护栏层决策。而且"忽略所有安全提醒"本身就是教科书级的注入特征，只会让可疑度更高。
>
> **正确做法**：
> - 开发 `adapter-claude-code` 这个包 → 用 **Hermes / cursor-agent**，不要用 CC。
> - 信号高度集中在 `adapter.ts`（spawn + skip-permissions + 流截获）。仓库其余部分（`core` / `server` / ocas 集成）很干净，照常用 CC 没问题。
> - 运行时不受影响：adapter 在目标项目的 `cwd` 下 spawn CC，CC 根本读不到 sumeru 的 CLAUDE.md。

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
| `sendTimeoutMs` | 1,800,000 (30 min) | Timeout for send (raised from 10 min in issue #32) |
| `spawnFn` | `defaultSpawn` | Test seam for child_process.spawn |

## createSession

Spawns:
```
claude -p "<initialQuery>" --output-format stream-json --verbose
  --dangerously-skip-permissions --max-turns <n> [--model <m>]
```

Parses the NDJSON output for the `system` line containing `session_id`. The initial turns are rewritten to start at index 0 and cached in-memory.

Returns a `NativeSessionRef` with meta: `{ cwd, model, createdAt, subtype }`.

## Permission Handling（`--dangerously-skip-permissions`：临时方案）

Both `createSession` and `send` pass **`--dangerously-skip-permissions`** (built in `buildArgs`). This bypasses *all* of Claude Code's permission checks. There is a `TODO(permission-suspend)` comment at the flag's call site in `adapter.ts` — keep this card and that comment in sync.

### 为什么现在需要它

Sumeru/uwf 跑的是**无人值守**的 agent 流程。CC 默认在执行写文件、跑命令等动作前会停下来等人确认；非交互（`-p`）模式下这会直接**死锁**整个 thread。`--dangerously-skip-permissions` 是当下让流程不卡住的最小手段。

> ⚠️ 代价：CC 在 `cwd` 下可以无确认地执行任何工具调用。**只在受信任、沙箱化的 `cwd` 里运行本 adapter。**

### 目标方案：把权限请求冒泡成 `$SUSPEND`

CC **原生**支持程序化权限通道，不必裸奔。相关 flag（`claude --help` 实测，CC v2.1+）：

| Flag | 作用 |
|------|------|
| `--permission-mode <mode>` | `default` / `plan` / `acceptEdits` / `dontAsk` / `bypassPermissions` / `auto`。`--dangerously-skip-permissions` ≈ `bypassPermissions` |
| `--input-format stream-json` | 配合 `--print`，允许**实时流式喂入** stdin 消息 |
| `--include-hook-events` | 把权限请求等 hook 生命周期事件**输出到 stream-json 流** |

设想的链路：CC 要权限 → 发 hook 事件到 stdout → adapter 捕获 → **不自动批准**，而是作为 uwf `$SUSPEND` 向上冒泡 → 人类 supervisor 用 `uwf thread resume` 批准/拒绝 → 答复经 stdin 喂回 CC。

### 难点：这是跨层、有状态的改动（不是改个 flag）

```
uwf ──(agent-sumeru)──▶ Sumeru HTTP ──(adapter-claude-code)──▶ claude CLI
 ▲                                                                  │
 └──────── 权限请求要从最底层一路冒泡到 uwf 的 step 边界 ◀────────────┘
```

- **Sumeru 层（机械可行）**：把 `--dangerously-skip-permissions` 换成 `--input-format stream-json --include-hook-events`，监听 permission 事件而非吞掉。
- **uwf 层（真正的难点）**：`$SUSPEND` 是 **per-step 粒度**的引擎级保留 `$status`（在 moderator 之前拦截、落盘、进程退出、`uwf thread resume` 恢复）。但权限请求发生在**一步的中途**。要支持它，得把"半截的 CC session + 待批权限"持久化、emit `$SUSPEND`、resume 时重新挂回该 CC session 并喂入人的答复——即把一个**步骤内事件**提升成**步骤边界事件**。骨架（suspend/resume）是现成的，缺的是这层有状态包装。

参见 `adapter.ts` 中 `buildArgs` 的 `TODO(permission-suspend)`。

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
