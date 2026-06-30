---
id: tc-update-and-delete
spec: crud-lifecycle
tags: [e2e, prototype, update, delete]
prerequisites:
  - Sumeru host running (port 7901)
  - Prototype "tc-mut-target" exists (for update/delete)
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
       "instructions": "Original instructions.",
       "skills": ["git"],
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
       "instructions": "Updated instructions for mutation test.",
       "skills": [],
       "defaults": null
     }'
   ```
   → 返回 200 + 更新后对象

2. 验证更新持久化：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/tc-mut-target | jq .
   ```
   → instructions 已更新，skills 为空数组，defaults 为 null

3. 更新不存在的 prototype（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/tc-ghost-mut \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-ghost-mut",
       "instructions": "Does not exist."
     }'
   ```
   → 返回 404

4. 删除 prototype（成功）：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' -X DELETE http://127.0.0.1:7901/prototypes/tc-mut-target
   ```
   → 返回 204

5. 验证删除后 GET 返回 404：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7901/prototypes/tc-mut-target
   ```
   → 返回 404

6. 删除不存在的 prototype（404）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/prototypes/tc-ghost-mut
   ```
   → 返回 404

## Expected

- [ ] Step 1 返回 HTTP 200，`type` = `@sumeru/prototype`
- [ ] Step 1 `value.instructions` = `"Updated instructions for mutation test."`
- [ ] Step 1 `value.skills` = `[]`，`value.defaults` = `null`
- [ ] Step 2 返回的字段与 Step 1 一致（持久化生效）
- [ ] Step 3 返回 HTTP 404，`value.error` = `prototype_not_found`
- [ ] Step 4 返回 HTTP 204
- [ ] Step 5 返回 HTTP 404
- [ ] Step 6 返回 HTTP 404，`value.error` = `prototype_not_found`

## Failure Signals

- Step 1 返回 404 → Setup 创建未生效，检查 POST 返回码
- Step 2 字段未变化 → PUT 可能未写盘，检查 data-store 逻辑
- Step 4 返回 404 → prototype 可能在 Step 1 之后意外消失
- Step 4 返回 200 而非 204 → DELETE handler 状态码错误
