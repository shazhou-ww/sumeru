---
id: tc-404-session-not-found
spec: standard-http-errors
tags: [e2e, errors, 404, session]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - No session with ID ses_FAKE exists
---

# 404 Session Not Found

验证请求不存在的 session 时返回 404 session_not_found 错误。

## Setup

无额外 setup。确认不存在 ID 为 ses_FAKE 的 session。

## Steps

1. GET 不存在的 session：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/sessions/ses_FAKE
   ```
   → 应返回 404

2. 验证错误结构：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/ses_FAKE | jq '.type'
   ```
   → 应返回 `"@sumeru/error"`

3. 验证错误码：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/ses_FAKE | jq '.value.error'
   ```
   → 应返回 `"session_not_found"`

4. 验证消息包含 session ID：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/ses_FAKE | jq '.value.message'
   ```
   → 应包含 "ses_FAKE" 或 "not found"

5. POST stop 不存在的 session：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/ses_FAKE/stop
   ```
   → 应返回 404

## Expected

- [ ] Step 1 HTTP 状态码为 404
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"session_not_found"`
- [ ] `.value.message` 包含 session 标识信息
- [ ] Step 5 HTTP 状态码为 404（stop 不存在的 session）

## Failure Signals

- 返回 200 → session 路由匹配但返回空对象
- 返回 500 → session lookup 抛出未处理异常
