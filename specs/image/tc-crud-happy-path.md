---
id: tc-crud-happy-path
spec: image-registry
tags: [e2e, image, crud, happy-path]
prerequisites:
  - "[e2e-prerequisites](../e2e-prerequisites.md) 已完成"
  - Host running on test port
---

# Image CRUD Happy Path

验证 image 的注册、查询、更新、删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/ | jq '.value.status'
   ```

2. 确保测试 image 不存在：
   ```bash
   curl -s -X DELETE http://127.0.0.1:$SUMERU_PORT/images/tc-test-image
   ```

## Steps

1. 注册 image（POST /images/:name）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:$SUMERU_PORT/images/tc-test-image \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-test-image","description":"Test image for e2e","dockerfile":"docker/hermes/Dockerfile","builtAt":"2026-07-01T12:00:00.000Z","digest":"sha256:abc123"}'
   ```

2. 查询单个 image（GET /images/:name）：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/images/tc-test-image | jq '.value.name'
   ```

3. 确认列表包含新 image（GET /images）：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/images | jq '.value[].name' | grep tc-test-image
   ```

4. 更新 image（POST 同名覆盖）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:$SUMERU_PORT/images/tc-test-image \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-test-image","description":"Updated description","dockerfile":"docker/hermes/Dockerfile","builtAt":"2026-07-01T13:00:00.000Z","digest":"sha256:def456"}'
   ```

5. 确认更新生效：
   ```bash
   curl -s http://127.0.0.1:$SUMERU_PORT/images/tc-test-image | jq '.value.description'
   ```

6. 删除 image（DELETE /images/:name）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:$SUMERU_PORT/images/tc-test-image
   ```

7. 确认删除后 GET 返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:$SUMERU_PORT/images/tc-test-image
   ```

## Expected

- [ ] Step 1 返回 200/201，body 含 `"name":"tc-test-image"`
- [ ] Step 2 返回 `"tc-test-image"`
- [ ] Step 3 grep 匹配到 tc-test-image
- [ ] Step 4 返回 200（覆盖成功）
- [ ] Step 5 返回 `"Updated description"`
- [ ] Step 6 返回 200/204
- [ ] Step 7 返回 404，`error` = `image_not_found`

## Cleanup

```bash
curl -s -X DELETE http://127.0.0.1:$SUMERU_PORT/images/tc-test-image
```

## Failure Signals

- Step 1 返回 405 → POST /images/:name 路由未注册
- Step 4 返回 409 → POST 未实现 upsert 语义
- Step 6 返回 404 → DELETE 在 image 存在时失败
