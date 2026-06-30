---
tc: tool_call → 执行工具 → 下一轮 LLM → 最终回复
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, tool-call, happy-path]
status: PASS
---

# TC: tool call → execute → final answer

## Setup

Mock fetch 返回两轮响应：
1. 第一轮：`tool_calls: [{ id: "call_1", function: { name: "terminal", arguments: '{"command":"echo hello"}' } }]`
2. 第二轮：`content: "done"`，无 tool_calls

## Steps

1. 调用 `adapter.handle({ content: "echo hello" })`
2. 收集产出的 turns 和 done value

## Expected

- [ ] `turns.length === 2`（第一轮带 toolCalls + 第二轮 final answer）
- [ ] `turns[0].toolCalls` 为非空数组
- [ ] `turns[0].toolCalls[0].id === "call_1"`（透传自 LlmToolCall.id）
- [ ] `turns[0].toolCalls[0].output` 非 null（工具已执行）
- [ ] `turns[1].content === "done"`
- [ ] `turns[1].toolCalls === null`
- [ ] `done.tokenUsage.input === 30`（10 + 20 跨迭代累加）
- [ ] `done.tokenUsage.output === 10`（5 + 5）

## Notes

sarsapa 的 assistant turn 内联 `toolCalls[]`（含 output），走 host legacy 路径派生 ToolTurn。

## Covered by

`packages/sarsapa/tests/loop.test.ts`
— `"runs a tool call then finishes with done"` test
