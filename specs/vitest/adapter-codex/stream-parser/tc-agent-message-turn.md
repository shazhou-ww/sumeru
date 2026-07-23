---
tc: agent_message 产出纯文本 assistant turn
spec: adapter-codex-stream-parser
tags: [adapter, codex, e2e, happy-path]
status: PASS
---

# TC: agent_message → assistant turn

## Preconditions

- "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
- Host running on port 7901
- Prototype `codex` available (Codex CLI image built + configured)

## Steps

1. **创建 session（纯文本任务，不触发命令执行）**：

```bash
SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
  -H 'Content-Type: application/json' \
  -d '{"prototype":"codex","project":"sumeru","task":"Reply with exactly: pong. Do not run any commands."}' \
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

- [ ] Step 2 最终 status = `idle`
- [ ] turns 中至少有 1 个 `role === "assistant"` turn
- [ ] assistant turn 的 `content` 包含 "pong"
- [ ] assistant turn 的 `toolCalls` 为 `null` 或空数组
- [ ] assistant turn 有 `durationMs`（number ≥ 0）
- [ ] assistant turn 有 `timestamp`（ISO string）

## Failure Signals

- status = `error` → 检查 exit.message，常见：Codex CLI 未安装、API key 无效
- 无 assistant turn → stream-parser 未解析 `turn.completed` JSONL 行
- content 为空 → agent_message items 的 text 未被正确提取
