---
tc: tool_call → 执行工具 → 结果回填 → 下一轮 LLM → 最终回复
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, e2e, tool-call, happy-path]
status: PASS
---

# TC: tool call → execute → final answer

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `sarsapa` available（内建 adapter，无外部 CLI 依赖）
- OpenAI-compatible endpoint 可达（host 配置中的 model/apiKey 有效）

## Steps

1. **创建 session（触发工具调用的任务）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"sarsapa","project":"sumeru","task":"Run terminal command: echo sarsapa-check"}' \
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

3. **获取全部 turns**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | jq '.value'
```

4. **找带 toolCalls 的 assistant turn**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value[] | select(.role=="assistant" and .toolCalls != null and (.toolCalls | length) > 0)'
```

5. **找 tool turn**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value[] | select(.role=="tool")'
```

6. **找最终回复的 assistant turn**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value | map(select(.role=="assistant")) | last'
```

## Expected

- [ ] Step 2 最终 status = `idle`
- [ ] Step 3 至少有 3 个 turns（assistant → tool → assistant）
- [ ] Step 4 的 assistant turn 有 `toolCalls`，`toolCalls[0].tool` = "terminal"
- [ ] Step 4 的 `toolCalls[0].output` 包含 "sarsapa-check"
- [ ] Step 5 存在 tool turn，`role === "tool"`
- [ ] tool turn 的 `callId` 与 assistant turn 的 `toolCalls[0].id` 一致
- [ ] tool turn 的 `result` 包含 "sarsapa-check"
- [ ] tool turn 的 `durationMs` ≥ 0
- [ ] Step 6 最终 assistant turn 的 content 非空（LLM 基于工具结果的回复）

## Failure Signals

- status = `error` → 检查 exit.message，常见：LLM endpoint 不可达、apiKey 无效
- 无 toolCalls → LLM 没选择调用工具（换更明确的 task prompt）
- output 为空 → tool 执行正常但结果未回填到 WireToolCall
- 无 tool turn → host 未从 WireToolCall.output 派生 ToolTurn
