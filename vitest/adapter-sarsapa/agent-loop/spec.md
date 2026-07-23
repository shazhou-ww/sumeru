---
feature: "@sumeru/sarsapa — 内建 agent loop (OpenAI Chat API)"
tags: [adapter, sarsapa, agent-loop, tool-call]
---

# sarsapa：内建 agent loop

`@sumeru/sarsapa` 是 Sumeru 的内建 adapter，直接调用 OpenAI-compatible Chat Completions
API 实现 agent loop（`loop.ts` 的 `runLoop`）。不依赖外部 CLI，由 sarsapa 自行管理
conversation context、tool execution 和迭代控制。

## 核心流程

```
LLM request → response
  ├─ no tool_calls → yield final assistant turn → return DoneValue
  └─ has tool_calls → execute tools → push results to conversation → next iteration
```

每次迭代：
1. 调用 `chat(request)` 发 LLM 请求
2. 如果 `res.toolCalls === null`：yield final assistant turn，return done
3. 如果有 tool_calls：
   - `pushAssistant` 记录到 conversation
   - `Promise.all` 并行执行所有 tool calls（`executeToolCall`）
   - `pushToolResult` 把结果推回 conversation
   - yield 一个 `TurnValue(role: "assistant", toolCalls: [WireToolCall])`
   - 进入下一轮迭代

## tool call 处理

`executeToolCall` 返回 `WireToolCall`，四个分支：

| 分支 | 条件 | output | exitCode |
|------|------|--------|----------|
| 正常执行 | tool 存在 + args 合法 | `result.output` | `result.exitCode` |
| JSON 解析失败 | `JSON.parse(call.arguments)` 抛异常 | Error 消息 + raw 前 300 字符 | 1 |
| 未知工具 | `tools.find` 返回 null | `"Error: unknown tool '...'"` | null |
| 工具抛异常 | `tool.execute` throws | `"Error: tool '...' threw (...)"` | 1 |

所有分支都传递 `id: call.id`（来自 `LlmToolCall.id`，即 OpenAI 的 `tool_call.id`）。

## token 累加

每次迭代的 `res.tokens` 累加到 `inputTokens` / `outputTokens`，最终在 `DoneValue.tokenUsage`
中返回跨迭代总和。

## 迭代上限

`maxIterations` 控制最大循环次数。达到上限时返回 `summary: "max iterations reached"`。

## 关键源码

- `packages/sarsapa/src/loop.ts`：`runLoop`、`executeToolCall`
- `packages/sarsapa/src/llm/client.ts`：`chat`（OpenAI Chat API 调用）
- `packages/sarsapa/src/types.ts`：`LlmToolCall`（含 `id: string`）
- `packages/adapter-core/src/wire-types.ts`：`WireToolCall`（含 required `id`）
