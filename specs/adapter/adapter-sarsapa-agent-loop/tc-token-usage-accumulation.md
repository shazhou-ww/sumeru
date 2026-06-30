---
tc: token usage 跨多轮迭代累加，最终 assistant turn 有正确 tokenUsage
spec: adapter-sarsapa-agent-loop
tags: [adapter, sarsapa, e2e, token-usage]
status: PASS
---

# TC: token usage 跨迭代累加

## Preconditions

- Sumeru host running (port 7901)
- Prototype `sarsapa` available

## Steps

1. **创建 session（触发至少一次工具调用 → 2 轮 LLM 推理）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"sarsapa","project":"sumeru","task":"Run: echo token-test. Then tell me what the output was."}' \
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

3. **获取 session exit 信息（含总 token）**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.exit'
```

4. **获取最后一个 assistant turn 的 tokenUsage**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value | map(select(.role=="assistant")) | last | .tokenUsage'
```

## Expected

- [ ] session exit 的 tokenUsage 非 null
- [ ] exit.tokenUsage.input > 0（至少 2 轮推理的 prompt tokens 之和）
- [ ] exit.tokenUsage.output > 0
- [ ] exit.tokenUsage.input 明显大于单轮推理的 prompt tokens（体现了累加）
- [ ] 最后一个 assistant turn 的 tokenUsage 也非 null

## Failure Signals

- tokenUsage = null → runLoop 的 usage 累加逻辑失效或 DoneValue 未传递
- input tokens 过小（< 50）→ 可能只累加了一轮
- session exit 无 tokenUsage 字段 → host 未从 adapter DoneValue 提取 usage
