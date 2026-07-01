---
id: tc-provider-error-paths
spec: crud-lifecycle
tags: [e2e, provider, error, validation]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Provider Error Paths

验证 Provider API 的各种错误路径。

## Setup

1. 创建用于冲突测试的 provider：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/providers/tc-conflict \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"openai","baseUrl":"https://api.openai.com"}'
   ```

2. 创建一个 model 引用该 provider（用于删除保护测试）：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/models/tc-dep-model \
     -H 'Content-Type: application/json' \
     -d '{"provider":"tc-conflict","model":"gpt-4o"}'
   ```

## Steps

1. 重复创建（409）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/providers/tc-conflict \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"openai","baseUrl":"https://api.openai.com"}'
   ```

2. 无效 apiType（400）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/providers/tc-bad-type \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"invalid","baseUrl":"https://example.com"}'
   ```

3. GET 不存在的 provider（404）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/providers/tc-ghost
   ```

4. PUT 不存在的 provider（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/tc-ghost \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"openai","baseUrl":"https://example.com"}'
   ```

5. DELETE 被 model 引用的 provider（409 provider_in_use）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/providers/tc-conflict
   ```

6. DELETE 不存在的 provider（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/providers/tc-ghost
   ```

## Expected

- [ ] Step 1 返回 409，`error` = `provider_exists`
- [ ] Step 2 返回 400，`error` = `invalid_body`，message 含 `apiType`
- [ ] Step 3 返回 404，`error` = `provider_not_found`
- [ ] Step 4 返回 404，`error` = `provider_not_found`
- [ ] Step 5 返回 409，`error` = `provider_in_use`
- [ ] Step 6 返回 404，`error` = `provider_not_found`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:7901/models/tc-dep-model
curl -s -X DELETE http://127.0.0.1:7901/providers/tc-conflict
```

## Failure Signals

- Step 5 返回 204 → 删除保护未生效，Model 将引用已删除的 Provider
