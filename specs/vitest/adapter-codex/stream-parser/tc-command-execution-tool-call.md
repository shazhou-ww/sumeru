---
tc: command_execution 产出 assistant turn（含 toolCalls）+ host 派生 ToolTurn
spec: adapter-codex-stream-parser
tags: [adapter, codex, e2e, tool-call, command-execution]
status: PASS
---

# TC: command_execution → toolCalls + ToolTurn

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `codex` available

## Steps

1. **创建 session（触发命令执行的任务）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"codex","project":"sumeru","task":"Run the command: echo codex-tc-check"}' \
  | jq -r '.value.id')
echo "Session: $SID"
```

2. **等待 session idle**（最多 2 分钟）：

```bash
for i in $(seq 1 60); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
echo "Final status: $STATUS"
```

3. **找带 toolCalls 的 assistant turn**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value[] | select(.role=="assistant" and .toolCalls != null and (.toolCalls | length) > 0)'
```

4. **找 tool turn**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value[] | select(.role=="tool")'
```

## Expected

- [ ] Step 3 找到至少 1 个 assistant turn 带 toolCalls
- [ ] `toolCalls[0].tool` 存在（command_execution 映射的工具名）
- [ ] `toolCalls[0].id` 存在（string，UUID 格式）
- [ ] `toolCalls[0].input` 包含 "echo codex-tc-check" 相关内容
- [ ] `toolCalls[0].output` 包含 "codex-tc-check"（命令执行结果）
- [ ] `toolCalls[0].exitCode` 为 0
- [ ] Step 4 至少有 1 个 `role === "tool"` turn
- [ ] tool turn 的 `callId` 与 `toolCalls[0].id` 一致
- [ ] tool turn 的 `result` 包含 "codex-tc-check"

## Failure Signals

- 无 toolCalls → stream-parser 未解析 command_execution items
- id 为空 → codex JSONL 无 id 字段且 UUID 生成逻辑失效
- output 为空 → command_execution 的 output 字段未被提取
- 无 tool turn → WireToolCall.output 未被填充，host 无法派生
