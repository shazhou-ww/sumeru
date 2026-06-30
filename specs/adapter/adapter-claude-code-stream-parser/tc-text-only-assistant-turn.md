---
tc: 纯文本回复 → 只产出 assistant turn，无 toolCalls
spec: adapter-claude-code-stream-parser
tags: [adapter, claude-code, e2e, happy-path]
status: PASS
---

# TC: 纯文本回复 → assistant turn

## Preconditions

- Sumeru host running (port 7901)
- Prototype `claude-code` available (Claude Code CLI image built + configured)

## Steps

1. **创建 session（纯文本任务，不触发工具调用）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"claude-code","project":"sumeru","task":"Reply with exactly: pong"}' \
  | jq -r '.value.id')
echo "Session: $SID"
```

2. **等待 session idle**：

```bash
for i in $(seq 1 30); do
  STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SID | jq -r '.value.status')
  [ "$STATUS" != "running" ] && break
  sleep 2
done
echo "Final status: $STATUS"
```

3. **获取 turns**：

```bash
curl -s http://127.0.0.1:7901/sessions/$SID/turns | jq '.value'
```

## Expected

- [ ] Step 1 返回 HTTP 201，`value.id` 以 `ses_` 开头
- [ ] Step 2 最终 status = `idle`
- [ ] turns 中至少有 1 个 `role === "assistant"` turn
- [ ] assistant turn 的 `content` 包含 "pong"
- [ ] assistant turn 的 `toolCalls` 为 `null` 或空数组
- [ ] assistant turn 有 `durationMs`（number ≥ 0）
- [ ] assistant turn 有 `timestamp`（ISO string）

## Failure Signals

- status = `error` → 检查 exit.message，常见：Claude CLI 未安装、API key 无效
- assistant turn 的 toolCalls 非空 → 任务触发了工具使用，换一个更简单的 task
- 无 assistant turn → stream-parser 可能没正确解析 CC CLI 输出
