---
id: tc-detail-not-found
spec: list-and-detail
tags: [e2e, api, error, session]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Detail Not Found: 404 Error Envelope

验证请求不存在的 session ID 时返回 `@sumeru/error` envelope 和 HTTP 404。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

## Steps

1. 请求一个不存在的 session：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7901/sessions/ses_NONEXISTENT
   ```

2. 获取完整响应体：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/ses_NONEXISTENT | jq .
   ```

## Expected

- [ ] Step 1 HTTP 状态码 = 404
- [ ] Step 2 响应 `type` = `@sumeru/error`
- [ ] `value.error` = `session_not_found`
- [ ] `value.message` 包含 `ses_NONEXISTENT`

## Failure Signals

- 返回 200 + 空对象 → 路由未校验 session 存在性
- 返回 500 → 未捕获的异常，检查 host 日志
- `type` 不是 `@sumeru/error` → error envelope 格式变更
