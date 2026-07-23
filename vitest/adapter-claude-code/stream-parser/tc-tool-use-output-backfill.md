---
tc: tool_use 产出 assistant turn（含 toolCalls）+ host 派生 ToolTurn
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, e2e, tool-use]
status: PASS
---

# TC: tool_use → toolCalls + ToolTurn

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `claude-code` available

## Steps

1. **创建 session（触发工具调用的任务）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"claude-code","project":"sumeru","task":"Run: echo hello-from-tc"}' \
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

3. **获取 turns，找 assistant turn 中的 toolCalls**：

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

- [ ] Step 3 找到至少 1 个 assistant turn，`toolCalls` 非空
- [ ] `toolCalls[0].tool` 是 "Bash" 或 "bash"（CC CLI 工具名）
- [ ] `toolCalls[0].id` 存在且以 `toolu_` 开头（Claude 原生 tool_use id）
- [ ] `toolCalls[0].input` 包含 "echo hello-from-tc"
- [ ] Step 4 至少有 1 个 `role === "tool"` turn
- [ ] tool turn 的 `callId` 与上面的 `toolCalls[0].id` 一致
- [ ] tool turn 的 `result` 包含 "hello-from-tc"
- [ ] tool turn 的 `durationMs` 是 number ≥ 0
- [ ] tool turn 的 `name` 存在（string）

## Failure Signals

- 无 assistant turn 带 toolCalls → stream-parser 的 extractToolCalls 未识别 tool_use block
- toolCalls[0].id 为空或 undefined → `id: item.id` 未从 content_block 取到
- 无 tool turn → stream-parser 未回填 WireToolCall.output，host 无法派生 ToolTurn
- tool turn 的 result 为空 → tool_result 事件的回填逻辑有问题
