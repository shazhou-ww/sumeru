---
tc: 异常工具执行（未知工具 / 参数错误）不崩溃，session 正常结束
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, e2e, error-handling, resilience]
status: PASS
---

# TC: 异常工具执行 → 不崩溃

## Preconditions

- Sumeru host running (port 7901)
- Prototype `sarsapa` available

## Steps

1. **创建 session（诱导 LLM 调用不存在的工具或错误参数）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"sarsapa","project":"sumeru","task":"Call the tool named nonexistent_xyz_tool with argument {\"x\":1}. If you cannot, just say CANNOT."}' \
  | jq -r '.value.id')
echo "Session: $SID"
```

2. **等待 session 结束**（最多 2 分钟）：

```bash
for i in $(seq 1 60); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
echo "Final status: $STATUS"
```

3. **检查 session 是否正常结束**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value | {status, exit}'
```

4. **检查 turns 中是否有错误 tool turn**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value[] | select(.role=="tool") | {callId, result, durationMs}'
```

## Expected

- [ ] Step 2 最终 status = `idle`（不是 `error`）— session 没崩溃
- [ ] session 在 2 分钟内结束（不 hang）
- [ ] 如果 LLM 调用了不存在的工具：tool turn 的 `result` 包含 "Error" 或错误描述
- [ ] 如果 LLM 拒绝调用（回复 "CANNOT"）：assistant turn content 包含 "CANNOT"
- [ ] 无论哪种情况，session 正常收尾

## Failure Signals

- status = `error` 且 exit.message 包含 "unknown tool" → executeToolCall 的错误没被 catch，直接 throw 了
- session hang 超时 → 工具错误后 loop 没继续下一轮
- 0 turns → adapter 在错误时 panic 没产出任何 turn

## Notes

由于 LLM 有时会拒绝调用不存在的工具（直接回复 CANNOT），此 tc 验证的是
**无论 LLM 的行为如何，session 都不会崩溃**。如果需要强制触发错误分支，
可以在 sarsapa 的 tools 配置中注册一个永远 throw 的 mock tool。
