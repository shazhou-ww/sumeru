---
feature: "@sumeru/adapter-claude-code — stream-parser NDJSON → TurnValue 映射"
tags: [adapter, claude-code, stream-parser, turns]
---

# adapter-claude-code：stream-parser NDJSON → TurnValue

`@sumeru/adapter-claude-code` 通过 `claude -p ... --output-format stream-json --verbose`
获取 Claude Code CLI 的 NDJSON 输出，由 `stream-parser.ts` 的 `parseStreamJson` 解析为
`TurnValue[]` + `DoneValue`。

## 核心职责

1. **系统行**（`type: "system"`）：提取 `session_id`、`model`
2. **助手行**（`type: "assistant"`）：提取文本和 `tool_use` → `TurnValue(role: "assistant")`
3. **用户行**（`type: "user"`）：
   - 含 `tool_result`：回填对应 `WireToolCall.output`（不产出新 turn）
   - 纯文本：产出 `TurnValue(role: "user")`
4. **结果行**（`type: "result"`）：提取 `subtype`、`usage`、`duration` → `DoneValue`

## tool_use → WireToolCall 关联机制

- `processAssistantLine`：从 `content` 中提取 `tool_use` 块 → `WireToolCall`（`id` 取自
  `tool_use.id`），存入 `pendingToolCalls` Map（key = `tool_use_id`）
- `processUserLine`：遇到 `tool_result` 时，通过 `tool_use_id` 在 Map 中找到对应
  `WireToolCall`，回填 `output`，从 Map 删除
- **不产出独立 tool turn**——tool 信息内联在 assistant turn 的 `toolCalls[]` 里，
  由 host `wire-turn.ts` 的 `mapLegacyToolCalls` 在 `output !== null` 时派生 public `ToolTurn`

## 关键源码

- `packages/adapter-claude-code/src/stream-parser.ts`：`parseStreamJson`、`extractToolCalls`、
  `extractToolUseIds`、`extractToolResultText`、`processAssistantLine`、`processUserLine`
- `packages/adapter-claude-code/src/adapter.ts`：`handle` 调用 `parseStreamJson`
- `packages/adapter-core/src/wire-types.ts`：`WireToolCall`（含 required `id`）
