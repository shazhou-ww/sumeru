---
id: tc-create-validation-errors
spec: crud-lifecycle
tags: [e2e, prototype, create, validation, error]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Prototype "tc-conflict-target" exists (for 409 test)
  - Persona "tc-persona" and Model "tc-model" exist in SQLite
---

# Create Prototype: Validation Errors

验证创建 prototype 时的各种错误路径。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建用于冲突测试的 prototype：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-conflict-target \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-conflict-target","persona":"tc-persona","model":"tc-model","image":"sumeru-worker:latest"}'
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
     -d '{"name":"tc-conflict-target","persona":"tc-persona","model":"tc-model","image":"sumeru-worker:latest"}'
   ```

2. body.name 与 URL 不匹配（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-url-name \
     -H 'Content-Type: application/json' \
     -d '{"name":"different-name","persona":"tc-persona","model":"tc-model","image":"sumeru-worker:latest"}'
   ```

3. 引用不存在的 persona（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-bad-persona \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-bad-persona","persona":"ghost-persona","model":"tc-model","image":"sumeru-worker:latest"}'
   ```

4. 引用不存在的 model（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-bad-model \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-bad-model","persona":"tc-persona","model":"ghost-model","image":"sumeru-worker:latest"}'
   ```

5. 缺少 persona 字段（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-missing-field \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-missing-field","model":"tc-model","image":"sumeru-worker:latest"}'
   ```

## Expected

- [ ] Step 1 返回 409，`error` = `prototype_exists`
- [ ] Step 2 返回 400，`error` = `invalid_body`，message 含 `must match`
- [ ] Step 3 返回 400，`error` = `persona_not_found`
- [ ] Step 4 返回 400，`error` = `model_not_found`
- [ ] Step 5 返回 400，`error` = `invalid_body`，message 含 `persona`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-conflict-target
curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-url-name
```

## Failure Signals

- Step 3 返回 201 → 创建时未校验 persona 引用有效性
- Step 4 返回 201 → 创建时未校验 model 引用有效性
