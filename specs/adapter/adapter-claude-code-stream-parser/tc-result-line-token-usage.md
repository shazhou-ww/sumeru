---
tc: result 行提取 token usage 到 DoneValue
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, token-usage]
status: PASS
---

# TC: result 行 → DoneValue token usage

## Setup

使用 `cc-stream.success.ndjson` 或 `cc-stream.tool-use.ndjson` fixture。

## Steps

1. 调用 `parseStreamJson(fixture)`
2. 检查 `result.usage`（即 `DoneValue.tokenUsage`）

## Expected

- [ ] `tokenUsage.input > 0`（来自 result 行的 `usage.input_tokens`）
- [ ] `tokenUsage.output > 0`（来自 result 行的 `usage.output_tokens`）
- [ ] `tokenUsage.cached >= 0`（来自 `cache_read_input_tokens`）
- [ ] `result.subtype` 正确映射（`"success"` / `"error_max_turns"` / `"incomplete"`）
- [ ] `result.durationMs` 为正整数

## Covered by

`packages/adapter-claude-code/tests/stream-parser.test.ts`
— `"populates subtype and usage from the result line"` test
