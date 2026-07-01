---
id: tc-happy-path-hello-world
spec: create-and-start
tags: [e2e, session, create, happy-path]
prerequisites:
  - Sumeru host running
  - Provider + Model + Persona + Prototype 已在 SQLite 和磁盘中创建
---

# Happy Path: Create Session & Hello World

验证完整的 session 创建→运行→退出流程。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. Seed 数据（如未创建）：
   ```bash
   # Provider
   curl -s -X POST http://127.0.0.1:7901/providers/tc-anthropic \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://api.anthropic.com","apiKey":"sk-test-key"}'

   # Model
   curl -s -X POST http://127.0.0.1:7901/models/tc-sonnet \
     -H 'Content-Type: application/json' \
     -d '{"provider":"tc-anthropic","model":"claude-sonnet-4-20250514"}'

   # Persona
   curl -s -X POST http://127.0.0.1:7901/personas/tc-basic \
     -H 'Content-Type: application/json' \
     -d '{"instructions":"A general-purpose coding agent.","skills":[]}'

   # Prototype (需要已有 compose.yaml)
   curl -s -X POST http://127.0.0.1:7901/prototypes/hermes \
     -H 'Content-Type: application/json' \
     -d '{"name":"hermes","persona":"tc-basic","model":"tc-sonnet","image":"sumeru-worker:latest"}'
   ```

3. 确认 prototype 已就绪：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes/hermes | jq '.value.prototype.model'
   ```
   → 应返回 `"tc-sonnet"`

## Steps

1. 创建 session：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"test-project","task":"Say hello"}'
   ```
   → 保存返回的 `value.id` 为 `$SID`

2. 订阅 SSE 等待退出：
   ```bash
   curl -sN http://127.0.0.1:7901/sessions/$SID/events
   ```
   → 等待 `event: exit`

3. 查看 session 详情：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/$SID | jq .
   ```

## Expected

- [ ] Step 1 返回 HTTP 201
- [ ] Step 1 `type` = `@sumeru/session`
- [ ] Step 1 `value.status` = `running`
- [ ] Step 1 `value.model.provider` 是对象（含 name/endpoint/apiType）
- [ ] Step 1 `value.model.name` = `claude-sonnet-4-20250514`
- [ ] Step 1 `value.prototype` = `hermes`
- [ ] Step 2 收到至少一个 `event: turn`（role=assistant）
- [ ] Step 2 收到 `event: exit`
- [ ] Step 3 `value.status` = `idle`
- [ ] Step 3 `value.exit` 非 null

## Failure Signals

- 404 prototype_not_found → prototype YAML 文件缺失或 persona/model 引用无效
- 500 model_not_found → SQLite 中 Model 未创建
- 500 provider_not_found → SQLite 中 Provider 未创建
- adapter 超时 → Docker image 未构建或容器启动失败
