---
tc: turn.completed 提取 token usage 到 assistant turn
spec: adapter-codex-stream-parser
tags: [adapter, codex, e2e, token-usage]
status: PASS
---

# TC: token usage 出现在 assistant turn

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `codex` available

## Steps

1. **创建 session**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"codex","project":"sumeru","task":"Reply with exactly: hi"}' \
  | jq -r '.value.id')
```

2. **等待 session idle**：

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
```

3. **检查最后一个 assistant turn 的 tokenUsage**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value | map(select(.role=="assistant")) | last | .tokenUsage'
```

## Expected

- [ ] tokenUsage 不是 `null`（adapter 从 turn.completed 拿到了 usage）
- [ ] tokenUsage.input 是非负整数
- [ ] tokenUsage.output 是非负整数
- [ ] tokenUsage.input + tokenUsage.output > 0

## Failure Signals

- tokenUsage = null → stream-parser 未从 JSONL turn.completed 提取 usage
- tokenUsage 全为 0 → turn.completed 有 usage 但 parseCodexJson 映射有误
- cached 为 0 但预期非零 → Codex CLI 返回 `cached_input_tokens`（非 `cache_read_input_tokens`），检查 `doneValueFromResultLine` 是否兼容两种字段名
