---
id: tc-happy-path-hello-world
spec: create-and-start
tags: [e2e, session, create, happy-path]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
---

# Happy Path: Create Session & Hello World

验证完整的 session 创建→运行→退出流程。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → `{ "running": 0, "queued": 0, "idle": 0 }`

2. 确认 prototype 可用：
   ```bash
   curl -s http://127.0.0.1:7901/prototypes | jq '.value[].name'
   ```
   → 应含 `"sarsapa"`

## Steps

1. 创建 session：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"sarsapa","project":"test-project","task":"Say hello world"}'
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
- [ ] Step 1 `value.model.name` = `deepseek-ai/DeepSeek-V3`
- [ ] Step 1 `value.prototype` = `sarsapa`
- [ ] Step 2 收到至少一个 `event: turn`（role=assistant）
- [ ] Step 2 收到 `event: exit`
- [ ] Step 3 `value.status` = `idle`
- [ ] Step 3 `value.exit` 非 null

## Failure Signals

- 404 prototype_not_found → `sumeru setup` 未执行或 prototype YAML 文件缺失
- 500 model_not_found → SQLite 中 Model 未创建（检查 `sumeru setup` 输出）
- 500 provider_not_found → SQLite 中 Provider 未创建
- adapter 超时 → Docker image 未构建（`sumeru image build sarsapa --agent sarsapa`）
