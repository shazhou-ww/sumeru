---
id: tc-provider-crud-happy-path
spec: crud-lifecycle
tags: [e2e, provider, crud]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Provider CRUD: Happy Path

验证 Provider 的创建→读取→更新→删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/providers/tc-provider
   ```

## Steps

1. 创建 Provider：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/providers/tc-provider \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://api.anthropic.com","apiKey":"sk-test-key"}'
   ```

2. 列出 Provider（应包含新建的）：
   ```bash
   curl -s http://127.0.0.1:7901/providers | jq '.value[] | select(.name=="tc-provider")'
   ```

3. 获取单个详情：
   ```bash
   curl -s http://127.0.0.1:7901/providers/tc-provider | jq .
   ```

4. 更新 Provider（改 baseUrl）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/tc-provider \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://proxy.example.com","apiKey":"sk-new-key"}'
   ```

5. 验证更新生效：
   ```bash
   curl -s http://127.0.0.1:7901/providers/tc-provider | jq '.value.baseUrl'
   ```

6. 删除 Provider：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/providers/tc-provider
   ```

7. 验证删除后 GET 返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/providers/tc-provider
   ```

## Expected

- [ ] Step 1 返回 201，`type` = `@sumeru/provider`
- [ ] Step 1 `value.name` = `tc-provider`，`value.apiType` = `anthropic`
- [ ] Step 1 `value.baseUrl` = `https://api.anthropic.com`
- [ ] Step 1 `value.createdAt` 和 `value.updatedAt` 为 ISO 时间字符串
- [ ] Step 2 列表中包含 `tc-provider`
- [ ] Step 3 返回 200，字段正确
- [ ] Step 4 返回 200
- [ ] Step 5 `baseUrl` = `https://proxy.example.com`
- [ ] Step 6 返回 204
- [ ] Step 7 返回 404

## Failure Signals

- 201 但 value 为空 → envelope 函数有 bug
- 更新后 baseUrl 未变 → SQLite UPDATE 未 commit
