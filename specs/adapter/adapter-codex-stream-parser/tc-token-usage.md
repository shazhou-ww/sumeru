---
tc: turn.completed 提取 token usage 到 DoneValue
spec: adapter-codex-stream-parser
tags: [adapter, codex, token-usage]
status: PASS
---

# TC: turn.completed → DoneValue token usage

## Setup

JSONL 包含 `turn.completed` 行：

```json
{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}
```

## Steps

1. 通过 `adapter.handle()` 消费到 `done`
2. 检查 `done.tokenUsage`

## Expected

- [ ] `tokenUsage.input === 10`
- [ ] `tokenUsage.output === 5`
- [ ] `tokenUsage.cached === 0`（Codex 不报告 cache tokens）

## Notes

- 无 `turn.completed` 时为 incomplete 结果，usage 归零
- `assembleResult` 从 `state.resultLine.usage` 提取

## Covered by

`packages/adapter-codex/tests/adapter.test.ts`
— `"handle spawns codex exec and yields assistant turns"` test (checks `tokenUsage`)
