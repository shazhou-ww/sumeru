---
id: tc-400-missing-fields
spec: standard-http-errors
tags: [e2e, errors, 400, validation, missing-fields]
prerequisites:
  - Sumeru host running (port 7901)
---

# 400 Missing Fields — Required Fields Absent

验证 POST /sessions 缺少必填字段 (prototype/project/task) 时返回 400 invalid_request。

## Setup

无额外 setup。确认 host 正在运行即可。

## Steps

1. 缺少 prototype 字段：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{"project": "my-app", "task": "do something"}'
   ```
   → 应返回 400

2. 缺少 project 字段：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{"prototype": "hermes", "task": "do something"}'
   ```
   → 应返回 400

3. 缺少 task 字段：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{"prototype": "hermes", "project": "my-app"}'
   ```
   → 应返回 400

4. 空 body：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{}'
   ```
   → 应返回 400

5. 验证错误码一致为 invalid_request：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{"project": "my-app", "task": "do something"}' | jq '.value.error'
   ```
   → 应返回 `"invalid_request"`

## Expected

- [ ] Step 1 HTTP 状态码为 400
- [ ] Step 2 HTTP 状态码为 400
- [ ] Step 3 HTTP 状态码为 400
- [ ] Step 4 HTTP 状态码为 400
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"invalid_request"`
- [ ] `.value.message` 包含 "prototype", "project", "task" 字段说明

## Failure Signals

- 返回 201 → 必填字段校验缺失
- 返回 500 → handler 逻辑异常
- error code 不是 invalid_request → 错误映射有误
