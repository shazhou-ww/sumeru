---
tc: agent_message 产出纯文本 assistant turn
spec: adapter-codex-stream-parser
tags: [adapter, codex, happy-path]
status: PASS
---

# TC: agent_message → assistant turn

## Setup

```typescript
const JSONL = [
  '{"type":"thread.started","thread_id":"thread_abc"}',
  '{"type":"item.completed","item":{"type":"agent_message","text":"hello from codex"}}',
  '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
].join("\n");
```

## Steps

1. 调用 adapter.handle({ content: "ping" })
2. 收集产出的 turns

## Expected

- [ ] `turns.length === 1`
- [ ] `turns[0].role === "assistant"`
- [ ] `turns[0].content === "hello from codex"`
- [ ] `turns[0].toolCalls === null`
- [ ] `done.tokenUsage.input === 10`
- [ ] `done.tokenUsage.output === 5`
- [ ] `adapter.getNativeId()` 返回 `thread_id`

## Covered by

`packages/adapter-codex/tests/adapter.test.ts`
— `"handle spawns codex exec and yields assistant turns"` test
