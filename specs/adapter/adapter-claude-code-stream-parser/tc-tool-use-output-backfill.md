---
tc: tool_use 产出带 toolCalls 的 assistant turn，tool_result 回填 output
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, tool-use, tool-turn]
status: PASS
---

# TC: tool_use → WireToolCall + tool_result 回填 output

## Setup

使用 `cc-stream.tool-use.ndjson` fixture（含 `tool_use` + `tool_result`）。

## Steps

1. 调用 `parseStreamJson(fixture)`
2. 找到含 `toolCalls !== null` 的 assistant turn

## Expected

- [ ] assistant turn 的 `toolCalls.length === 1`
- [ ] `toolCalls[0].tool === "Bash"`
- [ ] `toolCalls[0].id` 为非空字符串（来自 Claude API 的 `toolu_xxx`）
- [ ] `toolCalls[0].input` 包含 `command` 字段
- [ ] `toolCalls[0].output` 包含 tool_result 的文本（非 null，已被回填）
- [ ] **不**产出独立的 `role: "tool"` turn（CC 走 legacy 路径，tool_result 回填 output）
- [ ] tool_result 对应的 user line 不产出额外 user turn

## Covered by

`packages/adapter-claude-code/tests/stream-parser.test.ts`
— `"parseStreamJson — tool_use folded into ToolCall.output"` describe block
