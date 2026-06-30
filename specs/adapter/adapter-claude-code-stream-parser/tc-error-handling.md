---
tc: 异常终止（max_turns / error）session 正确收尾，不 hang
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, e2e, error-handling]
status: PASS
---

# TC: 异常终止正确收尾

## Preconditions

- Sumeru host running (port 7901)
- Prototype `claude-code` available

## Steps

1. **创建 session（触发 max_turns 限制的任务）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"claude-code","project":"sumeru","task":"Keep running commands in a loop: ls, pwd, date, whoami, repeat forever. Do not stop.","model":"claude-sonnet-4-20250514"}' \
  | jq -r '.value.id')
echo "Session: $SID"
```

2. **等待 session 结束**（max_turns 触发后 CC CLI 会自动结束）：

```bash
for i in $(seq 1 90); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
echo "Final status: $STATUS"
```

3. **检查 session exit 信息**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.exit'
```

4. **检查 turns 是否有内容**：

```bash
TURN_COUNT=$(curl -s http://127.0.0.1:7901/sessions/$SID/turns | jq '.value | length')
echo "Turn count: $TURN_COUNT"
```

## Expected

- [ ] Step 2 最终 status 为 `idle` 或 `error`（不卡在 `running`）
- [ ] 如果 status = `idle`：exit.subtype 可能为 "error_max_turns"
- [ ] Step 4 的 TURN_COUNT ≥ 1（即使异常终止也有 turns）
- [ ] session 在 3 分钟内结束（不 hang）

## Failure Signals

- 超过 3 分钟仍 running → adapter 未处理 CC CLI 的异常退出
- 0 turns → stream-parser 遇到异常后丢弃了所有已解析的 turns
- exit 为 null → host 未记录 adapter 的退出信息
