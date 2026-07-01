---
id: tc-stop-already-idle
spec: stop-running-session
tags: [e2e, session, lifecycle, stop, conflict]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - sumeru/hermes:dev image built from latest main
---

# Stop Already Idle Session

验证对一个已经 idle 的 session 执行 POST /sessions/:id/stop 返回 409 Conflict。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

2. 创建一个 session 并等待其自然完成：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with exactly: done"
     }' | jq -r '.value.id')
   echo "Created: $SID"
   ```

3. 等待 session 变为 idle：
   ```bash
   for i in $(seq 1 30); do
     STATUS=$(curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status')
     [ "$STATUS" = "idle" ] && break
     sleep 5
   done
   echo "Status: $STATUS"
   ```
   → 应为 `idle`

## Steps

1. 尝试停止已 idle 的 session：
   ```bash
   RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://127.0.0.1:7901/sessions/$SID/stop")
   HTTP_CODE=$(echo "$RESPONSE" | tail -1)
   BODY=$(echo "$RESPONSE" | sed '$d')
   echo "HTTP: $HTTP_CODE"
   echo "$BODY" | jq .
   ```
   → HTTP 应返回 `409`

2. 验证错误类型：
   ```bash
   echo "$BODY" | jq -r '.value.error'
   ```
   → 应为 `session_already_idle`

3. 验证错误消息：
   ```bash
   echo "$BODY" | jq -r '.value.message'
   ```
   → 应包含 `idle` 相关内容

## Expected

- [ ] Step 1 返回 HTTP 409
- [ ] Step 2 error = `session_already_idle`
- [ ] Step 3 message 包含相关说明

## Failure Signals

- 返回 200 → 对 idle session 的 stop 未做状态检查
- 返回 404 → session 创建失败或已被删除
- 返回 500 → 尝试关闭不存在的 runtime stdin 导致异常
