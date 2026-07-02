---
id: tc-extension-crud-happy-path
spec: crud-lifecycle
tags: [e2e, extension, crud]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Extension CRUD: Happy Path

验证 Extension 的创建→读取→更新→删除完整生命周期。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 清理残留：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/extensions/tc-rust
   ```

## Steps

1. 创建 Extension：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/extensions/tc-rust \
     -H 'Content-Type: application/json' \
     -d '{"description":"Rust toolchain","dockerfile":"RUN apt-get install -y rustc"}'
   ```

2. 列出 Extension（应包含新建的）：
   ```bash
   curl -s http://127.0.0.1:7901/extensions | jq '.value[] | select(.name=="tc-rust")'
   ```

3. 获取单个详情：
   ```bash
   curl -s http://127.0.0.1:7901/extensions/tc-rust | jq .
   ```

4. 更新 Extension（改 description）：
   ```bash
   curl -s -w '\n%{http_code}' -X PUT http://127.0.0.1:7901/extensions/tc-rust \
     -H 'Content-Type: application/json' \
     -d '{"description":"Rust toolchain v2","dockerfile":"RUN apt-get install -y rustc cargo"}'
   ```

5. 验证更新生效：
   ```bash
   curl -s http://127.0.0.1:7901/extensions/tc-rust | jq '.value.description'
   ```

6. 删除 Extension：
   ```bash
   curl -s -w '\n%{http_code}' -X DELETE http://127.0.0.1:7901/extensions/tc-rust
   ```

7. 验证删除后 GET 返回 404：
   ```bash
   curl -s -w '\n%{http_code}' http://127.0.0.1:7901/extensions/tc-rust
   ```

## Expected

- [ ] Step 1 返回 201，`type` = `@sumeru/extension`
- [ ] Step 1 `value.name` = `tc-rust`，`value.dockerfile` 非空
- [ ] Step 1 `value.createdAt` 和 `value.updatedAt` 为 ISO 时间字符串
- [ ] Step 2 列表中包含 `tc-rust`
- [ ] Step 3 返回 200，字段正确
- [ ] Step 4 返回 200
- [ ] Step 5 `description` = `Rust toolchain v2`
- [ ] Step 6 返回 204
- [ ] Step 7 返回 404

## Failure Signals

- 201 但 value 为空 → envelope 函数有 bug
- 更新后 description 未变 → YAML 写入或 reload 有 bug
- 删除后 GET 仍 200 → Map 未同步删除
