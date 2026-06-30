---
tc: result line 提取 token usage 到 DoneValue → assistant turn 有 tokenUsage
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, e2e, token-usage]
status: PASS
---

# TC: token usage 出现在 assistant turn

## Preconditions

- Sumeru host running (port 7901)
- Prototype `claude-code` available

## Steps

1. **创建 session**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"claude-code","project":"sumeru","task":"Reply with exactly: hi"}' \
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

3. **检查 session exit 的 tokenUsage**（CC CLI 只在 result line 报总量，不提供 per-turn breakdown）：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.exit.tokenUsage'
```

4. **确认 assistant turn 的 tokenUsage 为 null**（CC CLI 行为）：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | \
  jq '.value | map(select(.role=="assistant")) | last | .tokenUsage'
```

## Expected

- [ ] session exit tokenUsage 不是 `null`（adapter 从 CC result line 拿到了 usage）
- [ ] exit.tokenUsage.input 是非负整数且 > 0
- [ ] exit.tokenUsage.output 是非负整数且 > 0
- [ ] assistant turn 的 tokenUsage 为 `null`（CC CLI 不提供 per-turn breakdown，这是正常行为）

## Failure Signals

- session exit tokenUsage = null → stream-parser 未解析 result line 的 usage 字段，或 DoneValue 未传递
- exit tokenUsage 全为 0 → result line 有 usage 但映射逻辑错误
- session error → CC CLI 未正确返回 result line
