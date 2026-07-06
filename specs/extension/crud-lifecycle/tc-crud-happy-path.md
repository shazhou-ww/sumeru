---
id: tc-extension-crud-happy-path
spec: crud-lifecycle
tags: [e2e, extension, crud, dockerfile]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Extension CRUD: Happy Path

验证 Extension 的创建→读取→更新→列表→删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/extensions/tc-extension
   ```

## Steps

1. 创建 Extension（PUT 201）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/extensions/tc-extension \
     -H 'Content-Type: application/json' \
     -d '{"description":"MCP filesystem server","dockerfile":"FROM node:20\nRUN npm i @mcp/filesystem"}'
   ```

2. 获取单个详情（GET 200）：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/extensions/tc-extension | jq .
   ```

3. 列出 Extensions（应包含新建的）：
   ```bash
   curl -s http://127.0.0.1:7901/extensions | jq '.value[] | select(.name=="tc-extension")'
   ```

4. 更新 Extension（PUT 200，partial merge — 仅改 description，dockerfile 保留）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/extensions/tc-extension \
     -H 'Content-Type: application/json' \
     -d '{"description":"Updated MCP filesystem"}'
   ```

5. 验证更新生效（omitted fields preserved）：
   ```bash
   curl -s http://127.0.0.1:7901/extensions/tc-extension | jq '.value'
   ```

6. 删除 Extension（DELETE 204）：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/extensions/tc-extension
   ```

7. 验证删除后 GET 返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/extensions/tc-extension
   ```

## Expected

- [ ] Step 1 返回 201，`type` = `@sumeru/extension`
- [ ] Step 1 `value.name` = `tc-extension`，`value.dockerfile` 包含 `FROM node:20`
- [ ] Step 1 `value.description` = `MCP filesystem server`
- [ ] Step 1 `value.createdAt` 和 `value.updatedAt` 为 ISO 时间字符串
- [ ] Step 2 返回 200，字段与 Step 1 一致
- [ ] Step 3 列表 `type` = `@sumeru/extension-list`，包含 `tc-extension`
- [ ] Step 4 返回 200，`value.description` = `Updated MCP filesystem`
- [ ] Step 5 `dockerfile` 仍为 `FROM node:20\nRUN npm i @mcp/filesystem`（未被清空）
- [ ] Step 5 `updatedAt` > `createdAt`
- [ ] Step 6 返回 204
- [ ] Step 7 返回 404，`type` = `@sumeru/error`，`value.code` = `extension_not_found`

## Failure Signals

- 201 但 value 为空 → envelope 函数有 bug
- Step 4 返回 201 而非 200 → upsert 逻辑未区分 create/update
- Step 5 dockerfile 为空 → 部分更新未 merge 已有字段
- Step 6 返回 404 → 删除路由未匹配或 extension 已被提前清除
