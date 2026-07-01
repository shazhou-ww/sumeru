---
id: tc-delete-not-found
spec: delete-session
tags: [e2e, session, error, 404]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Delete Non-Existent Session → 404

验证删除一个不存在的 session 返回 404 及标准错误响应格式。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

## Steps

1. 删除一个不存在的 session：
   ```bash
   curl -s -w "\n%{http_code}" -X DELETE "http://127.0.0.1:7901/sessions/ses_NONEXISTENT000000000000000"
   ```
   → 应返回 `404`

2. 检查错误响应结构：
   ```bash
   curl -s -X DELETE "http://127.0.0.1:7901/sessions/ses_NONEXISTENT000000000000000" | jq '.'
   ```

## Expected

- [ ] Step 1 返回 HTTP 404
- [ ] Step 2 响应 `type` = `"@sumeru/error"`
- [ ] Step 2 响应 `value.error` = `"session_not_found"`
- [ ] Step 2 响应 `value.message` = `"Session not found"`

## Failure Signals

- 返回 204 而非 404 → 路由可能未做存在性检查就返回成功
- 返回 500 → session lookup 抛异常未被捕获
- 错误格式不符合 `@sumeru/error` → 检查 error handler middleware
