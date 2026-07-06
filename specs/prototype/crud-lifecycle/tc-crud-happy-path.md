---
id: tc-prototype-crud-happy-path
spec: crud-lifecycle
tags: [e2e, prototype, crud]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - SQLite contains Persona "coder" and Model "openai:gpt-4"
  - Adapter registry contains adapter "docker"
  - hostConfig.extensions contains "mcp-filesystem"
---

# Prototype CRUD: Happy Path

验证 Prototype 的创建→读取→更新→列表→删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-prototype
   ```

## Steps

1. 列出 prototypes（确认初始状态）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes
   ```

2. 创建 Prototype（PUT 201）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/tc-prototype \
     -H 'Content-Type: application/json' \
     -d '{"persona":"coder","model":"openai:gpt-4","adapter":"docker","extensions":["mcp-filesystem"]}'
   ```

3. 获取单个 Prototype（GET 200）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes/tc-prototype
   ```

4. 列出 Prototypes（应包含新建的）：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes | jq '.value[] | select(.name=="tc-prototype")'
   ```

5. 更新 Prototype（PUT 200 merge — 仅更新 model）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/prototypes/tc-prototype \
     -H 'Content-Type: application/json' \
     -d '{"model":"anthropic:claude-3"}'
   ```

6. 验证更新生效（merge 语义保留其他字段）：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/tc-prototype | jq '.value'
   ```

7. 删除 Prototype（DELETE 204）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/prototypes/tc-prototype
   ```

8. 验证删除后 GET 返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/prototypes/tc-prototype
   ```

## Expected

- [ ] Step 1 返回 200，`type` = `@sumeru/prototype-list`
- [ ] Step 2 返回 201，`type` = `@sumeru/prototype`
- [ ] Step 2 `value.name` = `tc-prototype`，`value.persona` = `coder`
- [ ] Step 2 `value.model` = `openai:gpt-4`，`value.adapter` = `docker`
- [ ] Step 2 `value.extensions` = `["mcp-filesystem"]`，`value.image` = `null`
- [ ] Step 3 返回 200，字段与创建时一致
- [ ] Step 4 列表中包含 `tc-prototype`
- [ ] Step 5 返回 200，`value.model` = `anthropic:claude-3`
- [ ] Step 6 `value.persona` = `coder`（merge 保留），`value.adapter` = `docker`（merge 保留）
- [ ] Step 6 `value.model` = `anthropic:claude-3`（已更新）
- [ ] Step 6 `value.extensions` = `["mcp-filesystem"]`（merge 保留）
- [ ] Step 7 返回 204
- [ ] Step 8 返回 404，`value.code` = `prototype_not_found`

## Failure Signals

- 201 但 value 为空 → envelope 函数有 bug
- PUT 已存在的 prototype 返回 201 而非 200 → upsert 判断逻辑错误
- 更新后其他字段丢失 → merge 语义未实现，覆盖了整个对象
- 删除返回 200 而非 204 → 状态码设置错误
- YAML 文件未在磁盘删除 → 文件系统操作失败
