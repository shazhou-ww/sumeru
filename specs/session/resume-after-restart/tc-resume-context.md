---
id: tc-resume-context
spec: resume-after-restart
tags: [e2e, session, resume, sarsapa]
prerequisites:
  - Host running
  - sarsapa image rebuilt with JSONL persistence support
---

# Resume Context: 重启后保持对话上下文

## Setup

1. 创建 session：
   ```bash
   SID=$(sumeru session add sarsapa --task "Hi, I'm Scott. Remember my name." | awk '{print $3}')
   ```

2. 等待 task 完成（约 10s），确认响应：
   ```bash
   sumeru session turns $SID
   ```
   → assistant 应回复包含 "Scott" 的问候

## Steps

1. 重启 host：
   ```bash
   sumeru server restart
   ```

2. 发后续消息：
   ```bash
   sumeru session send $SID "What's my name?"
   ```

3. 等待响应（约 10s），查看 turns：
   ```bash
   sumeru session turns $SID
   ```

## Verify

- assistant 回复应包含 "Scott"（证明上下文恢复成功）
- 不应回复 "I don't have context" 或 "start of our conversation"

## JSONL 验证（可选）

```bash
CONTAINER=$(docker ps --format '{{.Names}}\t{{.ID}}' | grep $SID | awk '{print $2}')
docker exec $CONTAINER cat /workspace/.sarsapa/session.jsonl
```
→ 应包含完整的 init + 所有 turns
