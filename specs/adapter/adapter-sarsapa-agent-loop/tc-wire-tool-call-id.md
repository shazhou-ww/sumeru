---
tc: WireToolCall.id 透传自 LlmToolCall.id
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, wire-tool-call, id]
status: PASS
---

# TC: WireToolCall.id 透传

## Behavior under test

`executeToolCall` 的所有返回路径都设置 `id: call.id`，确保 `WireToolCall.id` 与 LLM
返回的 `tool_call.id` 一致。host 端用这个 id 关联 assistant turn 的 toolCalls 和派生的 ToolTurn。

## Expected

4 个返回路径都传递 `id: call.id`：

- [ ] 正常执行路径（`loop.ts:66`）
- [ ] JSON 解析失败路径（`loop.ts:44`）
- [ ] 未知工具路径（`loop.ts:54`）
- [ ] 工具抛异常路径（`loop.ts:77`）

## Verification

由 `WireToolCall.id` 在 `adapter-core/wire-types.ts` 中为 `required` 保证——任何遗漏
`id` 的路径都会导致 TypeScript 编译错误。

## Covered by

TypeCheck + `packages/sarsapa/tests/loop.test.ts`
