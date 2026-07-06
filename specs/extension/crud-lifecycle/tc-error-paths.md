---
id: tc-extension-error-paths
spec: crud-lifecycle
tags: [e2e, extension, error, validation]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Extension Error Paths

验证 Extension API 的各种错误路径：404 not found、400 invalid_body。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确保测试 extension 存在（用于 empty dockerfile 测试）：
   ```bash
   curl -s -X PUT http://127.0.0.1:7901/extensions/tc-err-ext \
     -H 'Content-Type: application/json' \
     -d '{"description":"Error test extension","dockerfile":"FROM alpine"}'
   ```

3. 确保不存在的 extension 确实不存在：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/extensions/tc-ghost
   ```

## Steps

1. GET 不存在的 extension（404）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/extensions/tc-ghost
   ```

2. DELETE 不存在的 extension（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/extensions/tc-ghost
   ```

3. 创建时缺少 dockerfile（400 invalid_body）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/extensions/tc-bad-ext \
     -H 'Content-Type: application/json' \
     -d '{"description":"Missing dockerfile"}'
   ```

4. 更新时 dockerfile 为空字符串（400 invalid_body）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/extensions/tc-err-ext \
     -H 'Content-Type: application/json' \
     -d '{"dockerfile":""}'
   ```

## Expected

- [ ] Step 1 返回 404，`type` = `@sumeru/error`，`value.code` = `extension_not_found`
- [ ] Step 1 `value.message` = `Extension not found`
- [ ] Step 2 返回 404，`type` = `@sumeru/error`，`value.code` = `extension_not_found`
- [ ] Step 3 返回 400，`type` = `@sumeru/error`，`value.code` = `invalid_body`
- [ ] Step 3 `value.message` 含 `dockerfile is required on create`
- [ ] Step 4 返回 400，`type` = `@sumeru/error`，`value.code` = `invalid_body`
- [ ] Step 4 `value.message` 含 `dockerfile must be non-empty`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:7901/extensions/tc-err-ext
curl -s -X DELETE http://127.0.0.1:7901/extensions/tc-bad-ext
```

## Failure Signals

- Step 1 返回 200 空对象 → GET 路由未校验 extension 是否存在
- Step 2 返回 204 → DELETE 对不存在的资源未返回 404
- Step 3 返回 201 → 创建校验缺失，允许无 dockerfile 创建
- Step 4 返回 200 → 更新校验缺失，允许空 dockerfile 覆盖
