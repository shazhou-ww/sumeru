---
tc: 纯文本回复产出正确的 assistant turn
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, happy-path]
status: PASS
---

# TC: 纯文本回复 → assistant turn

## Setup

使用 `cc-stream.success.ndjson` fixture（无 tool_use）。

## Steps

1. 调用 `parseStreamJson(fixture)`
2. 检查 `result.turns`

## Expected

- [ ] `turns.length >= 2`（至少 user + assistant）
- [ ] 存在 `role === "assistant"` 的 turn
- [ ] assistant turn 的 `content` 为非空字符串
- [ ] assistant turn 的 `toolCalls === null`
- [ ] `result.subtype === "success"`
- [ ] `result.sessionId` 为非空字符串
- [ ] `result.model` 为非空字符串

## Covered by

`packages/adapter-claude-code/tests/stream-parser.test.ts`
— `"parseStreamJson — happy path (success.ndjson)"` describe block
