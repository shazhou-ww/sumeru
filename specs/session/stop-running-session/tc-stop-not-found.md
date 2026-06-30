---
id: tc-stop-not-found
spec: stop-running-session
tags: [e2e, session, lifecycle, stop, not-found]
prerequisites:
  - Sumeru host running (port 7901)
---

# Stop Non-Existent Session

验证对不存在的 session 执行 POST /sessions/:id/stop 返回 404 Not Found。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

## Steps

1. 尝试停止不存在的 session：
   ```bash
   RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://127.0.0.1:7901/sessions/ses_NONEXISTENT/stop")
   HTTP_CODE=$(echo "$RESPONSE" | tail -1)
   BODY=$(echo "$RESPONSE" | sed '$d')
   echo "HTTP: $HTTP_CODE"
   echo "$BODY" | jq .
   ```
   → HTTP 应返回 `404`

2. 验证错误类型：
   ```bash
   echo "$BODY" | jq -r '.value.error'
   ```
   → 应为 `session_not_found`

3. 验证错误消息：
   ```bash
   echo "$BODY" | jq -r '.value.message'
   ```
   → 应包含 `not found` 相关内容

## Expected

- [ ] Step 1 返回 HTTP 404
- [ ] Step 2 error = `session_not_found`
- [ ] Step 3 message 包含相关说明

## Failure Signals

- 返回 200/204 → 路由错误或 ID 校验缺失
- 返回 500 → 未处理 session 查找为空的情况
