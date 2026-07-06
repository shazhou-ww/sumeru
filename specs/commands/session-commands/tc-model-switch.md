---
id: tc-model-switch
spec: session-commands
tags: [e2e, session, commands, model, switch]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session "sess-001" exists and is idle
  - Model "anthropic:claude-3" registered in SQLite
---

# Model Switch via type:model Command

验证通过 model 命令切换 session 模型，返回 provider:model 确认。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建 session 并保存 ID：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"sarsapa","project":"test-model","task":"idle"}' | jq -r '.value.id'
   ```
   → 保存返回的 `value.id` 为 `$SID`

3. 确认目标 model 存在：
   ```bash
   curl -s http://127.0.0.1:7901/models | jq '.value[] | select(.name=="claude-3")'
   ```

## Steps

### Step 1 — Switch to valid model

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"model","provider":"anthropic","model":"claude-3"}'
```

### Step 2 — Verify session reflects new model

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.model'
```

### Step 3 — Switch to another valid model

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"model","provider":"openai","model":"gpt-4"}'
```

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 1 `type` = `@sumeru/command-result`
- [ ] Step 1 `value.command` = `model`
- [ ] Step 1 `value.result.provider` = `anthropic`
- [ ] Step 1 `value.result.model` = `claude-3`
- [ ] Step 2 session 详情中 model 已更新为 anthropic:claude-3
- [ ] Step 3 返回 HTTP 200
- [ ] Step 3 `value.result.provider` = `openai`
- [ ] Step 3 `value.result.model` = `gpt-4`
- [ ] model 命令为同步响应（200，非 202）

## Failure Signals

- 404 session_not_found → Session $SID 不存在
- 404 model_not_found → 目标 model 未在 SQLite 中注册（运行 `sumeru setup`）
- 400 model_invalid_format → provider 或 model 字段为空字符串
- 500 internal error → Provider 配置错误，检查 endpoint/apiKey
