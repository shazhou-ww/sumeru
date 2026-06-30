---
id: tc-create-happy-path
spec: crud-lifecycle
tags: [e2e, prototype, create]
prerequisites:
  - Sumeru host running (port 7901)
  - Prototype "tc-create-new" does NOT exist (clean state)
---

# Create Prototype: Happy Path

验证成功创建 prototype 的完整流程：POST 返回 201 + 正确的响应体 + 后续可 GET 到。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 确保目标 prototype 不存在（清理残留）：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-create-new
   ```

## Steps

1. 创建 prototype：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/prototypes/tc-create-new \
     -H 'Content-Type: application/json' \
     -d '{
       "name": "tc-create-new",
       "instructions": "A general-purpose coding agent.",
       "skills": ["bash"],
       "defaults": {
         "maxTurns": 20,
         "timeout": 300,
         "resources": { "cpu": 1, "memory": "2Gi" }
       }
     }'
   ```
   → 返回 201 + prototype 对象

2. 验证 prototype 可被 GET：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/tc-create-new | jq .
   ```
   → 返回与创建时一致的数据

3. 清理：
   ```bash
   curl -s -X DELETE http://127.0.0.1:7901/prototypes/tc-create-new
   ```

## Expected

- [ ] Step 1 返回 HTTP 201
- [ ] Step 1 `type` = `@sumeru/prototype`
- [ ] Step 1 `value.name` = `tc-create-new`
- [ ] Step 1 `value.instructions` = `"A general-purpose coding agent."`
- [ ] Step 1 `value.skills` = `["bash"]`
- [ ] Step 1 `value.defaults.maxTurns` = 20，`value.defaults.timeout` = 300
- [ ] Step 2 返回 HTTP 200，字段与 Step 1 一致

## Failure Signals

- 返回 409 → prototype 已存在，Setup 清理步骤未生效
- 返回 400 → 请求体格式有误，检查 Content-Type 和 JSON 结构
- Step 2 返回 404 → 写入持久化可能失败，检查 host 文件系统权限
