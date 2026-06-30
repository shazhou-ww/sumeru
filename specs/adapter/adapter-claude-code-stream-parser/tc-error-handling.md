---
tc: 异常终止（max_turns / incomplete / malformed）正确处理
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, error-handling]
status: PASS
---

# TC: 异常终止场景

## Scenario A: error_max_turns

### Setup
使用 `cc-stream.max-turns.ndjson` fixture。

### Expected
- [ ] `result.subtype === "error_max_turns"`
- [ ] `result.turns.length >= 1`（已累积的 turns 不丢弃）

## Scenario B: incomplete（无 result 行）

### Setup
使用 `cc-stream.incomplete.ndjson` fixture。

### Expected
- [ ] `parseStreamJson` 返回非 null（降级处理，不崩溃）
- [ ] `result.subtype === "incomplete"`
- [ ] 已解析的 turns 保留

## Scenario C: malformed 输入

### Setup
使用 `cc-stream.malformed.ndjson` fixture 或空字符串。

### Expected
- [ ] `parseStreamJson` 返回 `null`（无法提取任何有效数据）
- [ ] 空输入返回 `null`
- [ ] 不抛异常

## Covered by

`packages/adapter-claude-code/tests/stream-parser.test.ts`
— `"parseStreamJson — error_max_turns"`, `"— incomplete"`, `"— malformed input"` describe blocks
