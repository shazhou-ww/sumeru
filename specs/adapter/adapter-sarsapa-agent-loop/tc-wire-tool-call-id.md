---
tc: WireToolCall.id 透传自 LLM 的 tool_call.id
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, e2e, wire-tool-call, id]
status: PASS
---

# TC: WireToolCall.id 透传

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `sarsapa` available

## Steps

1. **创建 session（触发工具调用）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"sarsapa","project":"sumeru","task":"Run: echo id-check"}' \
  | jq -r '.value.id')
```

2. **等待 session idle**：

```bash
for i in $(seq 1 60); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
```

3. **提取 toolCalls[0].id 和对应 tool turn 的 callId**：

```bash
TURNS=$(curl -s http://127.0.0.1:7901/sessions/$SID/turns | jq '.value')
TOOL_CALL_ID=$(echo "$TURNS" | jq -r '[.[] | select(.role=="assistant" and .toolCalls != null)] | .[0].toolCalls[0].id')
TOOL_TURN_CALL_ID=$(echo "$TURNS" | jq -r '[.[] | select(.role=="tool")] | .[0].callId')
echo "toolCalls[0].id = $TOOL_CALL_ID"
echo "toolTurn.callId = $TOOL_TURN_CALL_ID"
```

## Expected

- [ ] `TOOL_CALL_ID` 非空且非 "null"
- [ ] `TOOL_CALL_ID` 是非空字符串（格式取决于上游 LLM：OpenAI 用 `call_` 前缀，Anthropic 用 `tooluse_` 前缀）
- [ ] `TOOL_TURN_CALL_ID` === `TOOL_CALL_ID`（id 透传一致）

## Failure Signals

- TOOL_CALL_ID 为 UUID 格式而非 `call_` 开头 → adapter 没用 LLM 返回的 id，自己生成了
- 两个 id 不一致 → host 在 wire→public 转换时丢失了 id 映射
- TOOL_CALL_ID 为空 → WireToolCall.id 未被填充
