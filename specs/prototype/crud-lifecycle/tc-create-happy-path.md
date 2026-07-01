---
id: tc-create-happy-path
spec: crud-lifecycle
tags: [e2e, prototype, create]
prerequisites:
  - Sumeru host running (port 7901)
  - Persona "tc-persona" and Model "tc-model" exist in SQLite
  - Prototype "tc-create-new" does NOT exist (clean state)
---

# Create Prototype: Happy Path

验证成功创建 prototype 的完整流程：POST 返回 201 + 正确的响应体 + 后续可 GET 到。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. Seed Persona 和 Model（如不存在）：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/providers/tc-provider \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://api.anthropic.com"}'

   curl -s -X POST http://127.0.0.1:7901/models/tc-model \
     -H 'Content-Type: application/json' \
     -d '{"provider":"tc-provider","model":"claude-sonnet-4-20250514"}'

   curl -s -X POST http://127.0.0.1:7901/personas/tc-persona \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"A general-purpose coding agent.","skills":[]}'
   ```

3. 确保目标 prototype 不存在（清理残留）：
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
       "persona": "tc-persona",
       "model": "tc-model",
       "image": "sumeru-worker:latest",
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
- [ ] Step 1 `value.prototype.name` = `tc-create-new`
- [ ] Step 1 `value.prototype.persona` = `tc-persona`
- [ ] Step 1 `value.prototype.model` = `tc-model`
- [ ] Step 1 `value.prototype.image` = `sumeru-worker:latest`
- [ ] Step 1 `value.prototype.defaults.maxTurns` = 20，`value.prototype.defaults.timeout` = 300
- [ ] Step 2 返回 HTTP 200，字段与 Step 1 一致

## Failure Signals

- 返回 409 → prototype 已存在，Setup 清理步骤未生效
- 返回 400 persona_not_found → Persona seed 失败
- 返回 400 model_not_found → Model seed 失败
- Step 2 返回 404 → 写入持久化可能失败，检查 host 文件系统权限
