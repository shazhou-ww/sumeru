---
id: tc-update-and-delete
spec: crud-lifecycle
tags: [e2e, prototype, update, delete]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Persona "tc-persona" and Model "tc-model" exist in SQLite
---

# Update & Delete: Mutation Operations

验证 PUT 更新和 DELETE 删除的正常路径及 404 错误路径。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建用于变更测试的 prototype：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/prototypes/tc-mut-target \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-mut-target",
       "persona": "tc-persona",
       "model": "tc-model",
       "image": "sumeru-worker:latest",
       "defaults": { "maxTurns": 10, "timeout": 60, "resources": { "cpu": 1, "memory": "1Gi" } }
     }'
   ```

3. 确保幽灵 prototype 不存在：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-ghost-mut
   ```

## Steps

1. 更新 prototype（成功）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/tc-mut-target \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-mut-target",
       "persona": "tc-persona",
       "model": "tc-model",
       "image": "sumeru-worker:v2",
       "defaults": { "maxTurns": 50, "timeout": 600, "resources": { "cpu": 2, "memory": "4Gi" } }
     }'
   ```

2. 验证更新生效：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/tc-mut-target | jq '.value.prototype'
   ```

3. 更新不存在的 prototype（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/tc-ghost-mut \
     -H 'Content-Type: application/json' \
     -d '{"name":"tc-ghost-mut","persona":"tc-persona","model":"tc-model","image":"sumeru-worker:latest"}'
   ```

4. 删除 prototype（成功）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/prototypes/tc-mut-target
   ```

5. 验证删除后 GET 返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes/tc-mut-target
   ```

6. 删除不存在的 prototype（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/prototypes/tc-ghost-mut
   ```

## Expected

- [ ] Step 1 返回 200
- [ ] Step 2 `image` = `sumeru-worker:v2`，`defaults.maxTurns` = 50
- [ ] Step 3 返回 404，`error` = `prototype_not_found`
- [ ] Step 4 返回 204
- [ ] Step 5 返回 404
- [ ] Step 6 返回 404

## Failure Signals

- Step 1 返回 400 → 请求体格式错误（检查是否包含所有必填字段）
- Step 2 字段未变 → 写入持久化失败或 reload 逻辑有 bug
