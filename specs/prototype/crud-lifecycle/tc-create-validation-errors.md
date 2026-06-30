---
id: tc-create-validation-errors
spec: crud-lifecycle
tags: [e2e, prototype, create, validation, error]
prerequisites:
  - Sumeru host running (port 7901)
  - Prototype "tc-conflict-target" exists (for 409 test)
---

# Create Prototype: Validation Errors

验证创建 prototype 时的三种错误路径：名称冲突 409、body name 与 URL 不匹配 400、缺少 instructions 400。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建用于冲突测试的 prototype：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-conflict-target \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-conflict-target",
       "instructions": "Exists for conflict testing."
     }'
   ```

3. 确保 name-mismatch 目标不存在：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-url-name
   ```

## Steps

1. 创建已存在的 prototype（409 冲突）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-conflict-target \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-conflict-target",
       "instructions": "Another agent."
     }'
   ```
   → 返回 409

2. body name 与 URL 不匹配（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-url-name \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-body-name",
       "instructions": "Mismatch test."
     }'
   ```
   → 返回 400

3. 缺少 instructions 字段（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-no-instructions \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-no-instructions"
     }'
   ```
   → 返回 400

## Expected

- [ ] Step 1 返回 HTTP 409
- [ ] Step 1 `type` = `@sumeru/error`，`value.error` = `prototype_exists`
- [ ] Step 2 返回 HTTP 400
- [ ] Step 2 `type` = `@sumeru/error`，`value.error` = `invalid_body`
- [ ] Step 2 `value.message` 包含 name 不匹配的说明
- [ ] Step 3 返回 HTTP 400
- [ ] Step 3 `type` = `@sumeru/error`，`value.error` = `invalid_body`
- [ ] Step 3 `value.message` 包含 `instructions` 字段缺失说明

## Failure Signals

- Step 1 返回 201 → 冲突检测失效，可能 Setup 创建未成功
- Step 2 返回 201 → name 一致性校验未实现
- Step 3 返回 201 → instructions 必填校验缺失
- 任何 Step 返回 500 → handler 逻辑异常，查看 host 日志
