---
id: tc-400-invalid-json
spec: standard-http-errors
tags: [e2e, errors, 400, validation, json]
prerequisites:
  - Sumeru host running (port 7901)
---

# 400 Invalid JSON — Malformed Request Body

验证发送非法 JSON 请求体时返回 400 invalid_json 错误。

## Setup

无额外 setup。确认 host 正在运行即可。

## Steps

1. 发送非法 JSON 体到 POST /sessions：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{invalid json'
   ```
   → 应返回 400

2. 验证错误响应结构：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{invalid json' | jq '.type'
   ```
   → 应返回 `"@sumeru/error"`

3. 验证错误码：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{invalid json' | jq '.value.error'
   ```
   → 应返回 `"invalid_json"`

4. 验证错误消息：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{invalid json' | jq '.value.message'
   ```
   → 应包含 "JSON" 相关描述

## Expected

- [ ] HTTP 状态码为 400
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"invalid_json"`
- [ ] `.value.message` 包含 JSON 解析错误描述

## Failure Signals

- 返回 500 → JSON 解析错误未被正确捕获
- 返回 200/201 → body 解析逻辑未执行
- error code 不是 invalid_json → 错误映射逻辑有误
