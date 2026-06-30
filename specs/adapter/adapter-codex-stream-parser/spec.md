---
feature: "@sumeru/adapter-codex — stream-parser JSONL → TurnValue 映射"
tags: [adapter, codex, stream-parser, turns]
---

# adapter-codex：stream-parser JSONL → TurnValue

`@sumeru/adapter-codex` 通过 `codex exec --json` 获取 Codex CLI 的 JSONL 输出，
由 `stream-parser.ts` 的 `parseCodexJson` / `parseCodexJsonIncremental` 解析为
`TurnValue[]` + `DoneValue`。

## 核心职责

1. **thread.started**：提取 `thread_id` → `sessionId`
2. **item.completed (agent_message)**：提取 `text` → `TurnValue(role: "assistant")`
3. **item.completed (command_execution)**：提取 `command / aggregated_output / exit_code`
   → `TurnValue(role: "assistant", toolCalls: [WireToolCall])`
4. **turn.completed**：提取 `usage` → `DoneValue.tokenUsage`

## tool call 处理

Codex CLI 的 `command_execution` item 已经包含了执行结果（`aggregated_output`、
`exit_code`），因此 `WireToolCall` 在构造时 **同时填充 input 和 output**。
host 的 `mapLegacyToolCalls` 检测到 `output !== null` 后派生 public `ToolTurn`。

`WireToolCall.id`：优先从 `item.id` 取；无 id 时回退到 `crypto.randomUUID()`。

## 与其他 adapter 的差异

| 特性 | codex | claude-code | hermes |
|------|-------|-------------|--------|
| tool 结果来源 | item 已含 output | tool_result 回填 | ACP tool_call_update |
| 产出 role:"tool" | 否（走 legacy） | 否（走 legacy） | 是（progressive） |
| WireToolCall.id 来源 | item.id / UUID | toolu_xxx | ACP tool_call_id |

## 关键源码

- `packages/adapter-codex/src/stream-parser.ts`：`parseCodexJson`、`parseCodexJsonIncremental`、`processItemCompleted`
- `packages/adapter-codex/src/adapter.ts`：`handle` 调用增量解析
- `packages/adapter-core/src/wire-types.ts`：`WireToolCall`
