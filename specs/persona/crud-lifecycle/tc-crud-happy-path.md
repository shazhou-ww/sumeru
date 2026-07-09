---
id: tc-persona-crud-happy-path
spec: crud-lifecycle
tags: [e2e, persona, crud]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Persona CRUD: Happy Path

验证 Persona 的创建→读取→更新→删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/personas/tc-persona
   ```

## Steps

1. 创建 Persona：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/personas/tc-persona \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"A test agent for e2e verification."}'
   ```

2. 列出 Persona：
   ```bash
   curl -s http://127.0.0.1:7901/personas | jq '.value[] | select(.name=="tc-persona")'
   ```

3. 获取单个详情：
   ```bash
   curl -s http://127.0.0.1:7901/personas/tc-persona | jq .
   ```

4. 更新 Persona（改 instructions）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/personas/tc-persona \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"Updated instructions for testing."}'
   ```

5. 验证更新生效：
   ```bash
   curl -s http://127.0.0.1:7901/personas/tc-persona | jq '.value.instructions'
   ```

6. 删除 Persona：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/personas/tc-persona
   ```

7. 验证删除后返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/personas/tc-persona
   ```

## Expected

- [ ] Step 1 返回 201，`type` = `@sumeru/persona`
- [ ] Step 1 `value.name` = `tc-persona`
- [ ] Step 1 `value.instructions` 为创建时的文本
- [ ] Step 1 `value.createdAt` 和 `value.updatedAt` 为 ISO 时间字符串
- [ ] Step 2 列表中包含 `tc-persona`
- [ ] Step 3 返回 200，字段正确
- [ ] Step 4 返回 200
- [ ] Step 5 instructions 为 `Updated instructions for testing.`
- [ ] Step 6 返回 204
- [ ] Step 7 返回 404

## Failure Signals

- Step 1 返回 400 → 请求体格式错误
