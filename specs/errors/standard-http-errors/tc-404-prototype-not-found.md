---
id: tc-404-prototype-not-found
spec: standard-http-errors
tags: [e2e, errors, 404, prototype]
prerequisites:
  - Sumeru host running (port 7901)
  - No prototype named "ghost-proto" exists
---

# 404 Prototype Not Found

验证请求不存在的 prototype 或用不存在的 prototype 创建 session 时返回 404。

## Setup

无额外 setup。确认不存在名为 ghost-proto 的 prototype。

## Steps

1. GET 不存在的 prototype：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes/ghost-proto
   ```
   → 应返回 404

2. 验证错误码：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/ghost-proto | jq '.value.error'
   ```
   → 应返回 `"prototype_not_found"`

3. 验证消息包含 prototype 名称：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/ghost-proto | jq '.value.message'
   ```
   → 应包含 "ghost-proto"

4. POST /sessions 引用不存在的 prototype：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "prototype": "nonexistent",
       "project": "my-app",
       "task": "build feature"
     }'
   ```
   → 应返回 404

5. 验证 session 创建时 prototype_not_found 错误：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "prototype": "nonexistent",
       "project": "my-app",
       "task": "build feature"
     }' | jq '.value.error'
   ```
   → 应返回 `"prototype_not_found"`

## Expected

- [ ] Step 1 HTTP 状态码为 404
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"prototype_not_found"`
- [ ] `.value.message` 包含 "ghost-proto"
- [ ] Step 4 HTTP 状态码为 404
- [ ] Step 5 `.value.error` = `"prototype_not_found"`

## Failure Signals

- 返回 200 → prototype 路由错误或返回空对象
- 返回 500 → prototype lookup 未被正确处理
- Step 4 返回 400 → session body 校验先于 prototype 校验执行
