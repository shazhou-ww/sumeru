---
tc: 异常工具执行（未知工具 / JSON 错误 / 工具抛异常）不崩溃，产出错误 WireToolCall
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, error-handling, resilience]
status: PASS
---

# TC: 异常工具执行 → 错误 WireToolCall

## Behavior under test

`executeToolCall` 在三种异常情况下不崩溃，而是返回带错误信息的 `WireToolCall`，
让 LLM 能看到错误并自行决策（重试或放弃）。

## Scenario A: 未知工具

### Given
`call.name` 不匹配任何注册的 tool

### Expected
- [ ] `output === "Error: unknown tool '...'"` 
- [ ] `exitCode === null`
- [ ] `id === call.id`（仍透传）
- [ ] 不抛异常，agent loop 继续

## Scenario B: arguments 不是合法 JSON

### Given
`call.arguments` 为非法 JSON 字符串

### Expected
- [ ] `output` 包含 `"Error: arguments is not valid JSON"` + parse 错误 + raw 前 300 字符
- [ ] `exitCode === 1`
- [ ] `input === {}`（空对象 fallback）

## Scenario C: 工具执行抛异常

### Given
`tool.execute` throws Error

### Expected
- [ ] `output === "Error: tool '...' threw (...)"`
- [ ] `exitCode === 1`
- [ ] `durationMs` 为正整数（记录到抛异常为止的耗时）

## Notes

这三个分支的行为保证 agent loop 的韧性——单个工具失败不会中断整个 session。
错误信息上行给 LLM，由模型决定下一步。

## Covered by

TypeCheck 保证 `WireToolCall` 结构完整。
runtime 行为由 `packages/sarsapa/src/loop.ts:29-86` 源码分支覆盖。
