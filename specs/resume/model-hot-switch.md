---
id: tc-model-hot-switch
spec: resume
tags: [e2e, session, model, hot-switch, message]
prerequisites:
  - "[e2e-prerequisites](../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session in idle state (completed first task)
  - Multiple Models registered in SQLite
---

# Model Hot-Switch on Message Resume

验证向 idle session 发送后续消息时通过 `model` 字段切换 model 的能力。

## 背景

`submitMessage()` 在收到 `body.model !== null` 时调用 `resolveSessionModel()`，
若解析出的 ModelConfig 与当前 session 的 model 不同，会更新 `record.model` 并触发
`invalidateAdapterSession()` 重新向 adapter 发送 init config。

支持的 `model` 字段格式与 session 创建相同（三态）。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. Seed 两个 Model（共用同一个 Provider）：
   ```bash
   # Provider（如已存在跳过）
   curl -s -X POST http://127.0.0.1:7901/providers/tc-anthropic \
     -H 'Content-Type: application/json' \
     -d '{"apiType":"anthropic","baseUrl":"https://api.anthropic.com","apiKey":"sk-test-key"}'

   # Model A
   curl -s -X POST http://127.0.0.1:7901/models/tc-sonnet \
     -H 'Content-Type: application/json' \
     -d '{"provider":"tc-anthropic","model":"claude-sonnet-4-20250514"}'

   # Model B
   curl -s -X POST http://127.0.0.1:7901/models/tc-opus \
     -H 'Content-Type: application/json' \
     -d '{"provider":"tc-anthropic","model":"claude-opus-4-20250514"}'
   ```

3. 创建 session 并等待 idle：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"test","task":"Say A"}' | jq -r '.value.id')
   # 等待 exit event...
   curl -sN http://127.0.0.1:7901/sessions/$SID/events | grep -m1 'event: exit'
   ```

4. 确认 session idle 且初始 model：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.model.name'
   ```
   → 应为 `claude-sonnet-4-20250514`（prototype 默认 model）

## Steps

1. 发送后续消息并切换 model（Model ID 模式）：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/messages \
     -H 'Content-Type: application/json' \
     -d '{"content":"Say B","model":"tc-opus"}'
   ```
   → HTTP 202

2. 等待退出并检查 model 是否已切换：
   ```bash
   curl -sN http://127.0.0.1:7901/sessions/$SID/events | grep -m1 'event: exit'
   curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.model.name'
   ```
   → 应为 `claude-opus-4-20250514`

3. 再次切换回原 model：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions/$SID/messages \
     -H 'Content-Type: application/json' \
     -d '{"content":"Say C","model":"tc-sonnet"}'
   curl -sN http://127.0.0.1:7901/sessions/$SID/events | grep -m1 'event: exit'
   curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.model.name'
   ```
   → 应为 `claude-sonnet-4-20250514`

## Expected

- [ ] Step 1 返回 HTTP 202
- [ ] Step 2 `model.name` = `claude-opus-4-20250514`
- [ ] Step 3 `model.name` = `claude-sonnet-4-20250514`（切回原 model）
- [ ] 每次切换后 adapter 收到新的 init config（可通过 SSE turn 中的行为差异间接验证）

## Variant: Ad-hoc Model Override

使用 inline object 而非 Model ID：

```json
{
  "content": "Say D",
  "model": {
    "provider": {
      "name": "custom-proxy",
      "endpoint": "http://my-proxy:8080",
      "apiType": "openai"
    },
    "name": "gpt-4o"
  }
}
```

- [ ] 切换成功，session model 变为 ad-hoc 配置

## Failure Signals

- 404 session_not_found → session ID 错误
- 409 session_busy → session 仍在 running，需等 idle
- 500 model_not_found → Model ID 在 SQLite 中不存在
