---
id: tc-model-error-paths
spec: crud-lifecycle
tags: [e2e, model, error, validation]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Provider "tc-provider" exists in SQLite
---

# Model Error Paths

验证 Model API 的各种错误路径。

## Setup

1. 创建用于冲突测试的 model：
   ```bash
   curl -s -X PUT http://127.0.0.1:7901/providers/tc-provider/models/tc-conflict-model \
     -H 'Content-Type: application/json' \
     -d '{"model":"gpt-4o"}'
   ```

## Steps

1. upsert 已存在 model（200 更新，非 409）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/tc-provider/models/tc-conflict-model \
     -H 'Content-Type: application/json' \
     -d '{"model":"gpt-4o"}'
   ```

2. 引用不存在的 provider（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/ghost-provider/models/tc-bad-provider \
     -H 'Content-Type: application/json' \
     -d '{"model":"gpt-4o"}'
   ```

3. 新建时缺少 model 字段（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/tc-provider/models/tc-no-model \
     -H 'Content-Type: application/json' \
     -d '{}'
   ```

4. GET 不存在的 model（404）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/providers/tc-provider/models/tc-ghost-model
   ```

5. PUT 不存在的 provider（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/ghost-provider/models/tc-ghost-model \
     -H 'Content-Type: application/json' \
     -d '{"model":"gpt-4o"}'
   ```

6. DELETE 不存在的 model（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/providers/tc-provider/models/tc-ghost-model
   ```

## Expected

- [ ] Step 1 返回 200（upsert 语义）
- [ ] Step 2 返回 404，`error` = `provider_not_found`
- [ ] Step 3 返回 400，`error` = `invalid_body`，message 含 `model`
- [ ] Step 4 返回 404，`error` = `model_not_found`
- [ ] Step 5 返回 404，`error` = `provider_not_found`
- [ ] Step 6 返回 404，`error` = `model_not_found`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:7901/providers/tc-provider/models/tc-conflict-model
```

## Failure Signals

- Step 2 返回 201 → provider 引用校验未实现
