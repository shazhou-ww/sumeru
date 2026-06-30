---
tc: token usage 跨迭代累加
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, token-usage]
status: PASS
---

# TC: token usage 跨迭代累加

## Behavior under test

`runLoop` 每次迭代把 `res.tokens` 累加到 `inputTokens` / `outputTokens`，
最终 `DoneValue.tokenUsage` 反映整个 agent loop 的总消耗。

## Setup

Mock fetch 返回两轮：
1. 第一轮：`usage: { prompt_tokens: 10, completion_tokens: 5 }`
2. 第二轮：`usage: { prompt_tokens: 20, completion_tokens: 5 }`

## Expected

- [ ] `done.tokenUsage.input === 30`（10 + 20）
- [ ] `done.tokenUsage.output === 10`（5 + 5）
- [ ] `done.tokenUsage.cached === 0`（sarsapa 不追踪 cache tokens）
- [ ] 各 turn 的 `tokens` 反映当轮的 usage（非累计值）

## Notes

达到 `maxIterations` 上限时，`DoneValue.summary === "max iterations reached"`，
token 累加仍然正确。

## Covered by

`packages/sarsapa/tests/loop.test.ts`
— `"runs a tool call then finishes with done"` test（checks `doneValue.tokenUsage.input === 30`）
