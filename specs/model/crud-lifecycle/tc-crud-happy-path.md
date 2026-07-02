---
id: tc-model-crud-happy-path
spec: crud-lifecycle
tags: [e2e, model, crud]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Provider "tc-provider" exists in SQLite
---

# Model CRUD: Happy Path

验证 Model 的创建→读取→更新→删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确保 Provider 存在：
   ```bash
   curl -s -X PUT http://127.0.0.1:7901/providers/tc-provider \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://api.anthropic.com"}'
   ```

3. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/providers/tc-provider/models/tc-model
   ```

## Steps

1. 创建 Model（upsert）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/tc-provider/models/tc-model \
     -H 'Content-Type: application/json' \
     -d '{"model":"claude-sonnet-4-20250514","contextWindow":200000}'
   ```

2. 列出 Model：
   ```bash
   curl -s http://127.0.0.1:7901/models | jq '.value[] | select(.name=="tc-model" and .provider=="tc-provider")'
   ```

3. 获取单个详情：
   ```bash
   curl -s http://127.0.0.1:7901/providers/tc-provider/models/tc-model | jq .
   ```

4. 更新 Model（改 model 名和 contextWindow）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/providers/tc-provider/models/tc-model \
     -H 'Content-Type: application/json' \
     -d '{"model":"claude-opus-4-20250514","contextWindow":400000}'
   ```

5. 验证更新生效：
   ```bash
   curl -s http://127.0.0.1:7901/providers/tc-provider/models/tc-model | jq '{model: .value.model, contextWindow: .value.contextWindow}'
   ```

6. 删除 Model：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/providers/tc-provider/models/tc-model
   ```

7. 验证删除后返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/providers/tc-provider/models/tc-model
   ```

## Expected

- [ ] Step 1 返回 201，`type` = `@sumeru/model`
- [ ] Step 1 `value.name` = `tc-model`，`value.provider` = `tc-provider`
- [ ] Step 1 `value.model` = `claude-sonnet-4-20250514`
- [ ] Step 1 `value.toolUse` = true，`value.streaming` = true（默认值）
- [ ] Step 2 列表中包含 `tc-provider:tc-model`
- [ ] Step 3 返回 200，字段与创建一致
- [ ] Step 4 返回 200
- [ ] Step 5 `model` = `claude-opus-4-20250514`，`contextWindow` = 400000
- [ ] Step 6 返回 204
- [ ] Step 7 返回 404

## Failure Signals

- Step 1 返回 404 provider_not_found → Provider seed 失败
