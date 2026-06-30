---
tc: command_execution 产出带 toolCalls 的 assistant turn（含 output + exitCode）
spec: adapter-codex-stream-parser
tags: [adapter, codex, tool-call, command-execution]
status: PASS
---

# TC: command_execution → WireToolCall（含 output）

## Setup

构造包含 `command_execution` item 的 JSONL：

```json
{"type":"item.completed","item":{"type":"command_execution","id":"exec_1","status":"completed","command":"echo hello","aggregated_output":"hello\n","exit_code":0}}
```

## Steps

1. 调用 `parseCodexJson(jsonl)`
2. 找到含 `toolCalls !== null` 的 turn

## Expected

- [ ] turn 的 `toolCalls.length === 1`
- [ ] `toolCalls[0].tool === "command_execution"`
- [ ] `toolCalls[0].id` 为非空字符串（来自 `item.id` 或 UUID）
- [ ] `toolCalls[0].input` 包含 `{ command: "echo hello" }`
- [ ] `toolCalls[0].output === "hello\n"`（已填充，非 null）
- [ ] `toolCalls[0].exitCode === 0`
- [ ] **不**产出独立 `role: "tool"` turn（走 legacy 路径，host 派生）

## Notes

- `status !== "completed"` 的 command_execution 应被忽略（不产出 turn）
- Codex 的 command_execution item 自带执行结果，不需要后续回填

## Covered by

`packages/adapter-codex/tests/adapter.test.ts`（当前 fixture 不含 command_execution，
此 tc 描述的是 `stream-parser.ts:68-95` 的行为规范）
