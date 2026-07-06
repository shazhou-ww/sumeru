---
id: tc-error-paths
spec: session-commands
tags: [e2e, session, commands, error, negative]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session "sess-001" exists and is idle (for session_busy test)
---

# Error Paths: session_not_found, session_busy, invalid_request, model_not_found

验证 session commands 各种错误场景返回正确的错误码和消息。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建 session 用于 session_busy 测试：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"sarsapa","project":"test-errors","task":"idle"}' | jq -r '.value.id')
   ```

## Steps

### Step 1 — session_not_found (404)

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/nonexistent-session-id/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"exec","command":"echo hello"}'
```

### Step 2 — session_busy (409)

先发送一个 chat 命令让 session 进入 busy 状态，然后立即发送另一个 chat：

```bash
# 触发 busy 状态
curl -s -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"chat","content":"Write a long essay about AI","messageId":null,"env":null,"model":null}'

# 立即发送第二个 chat（应返回 409）
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"chat","content":"Another message","messageId":null,"env":null,"model":null}'
```

### Step 3 — invalid_request: invalid command type (400)

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"invalid-command-type"}'
```

### Step 4 — invalid_request: invalid JSON body (400)

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d 'not valid json at all'
```

### Step 5 — model_not_found (404)

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"model","provider":"fake-provider","model":"nonexistent-model"}'
```

### Step 6 — invalid_request: missing type field (400)

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"command":"exec","args":"ls"}'
```

## Expected

- [ ] Step 1 返回 HTTP 404
- [ ] Step 1 `type` = `@sumeru/error`
- [ ] Step 1 `value.code` = `session_not_found`
- [ ] Step 1 `value.message` = `Session not found`
- [ ] Step 2 第二个请求返回 HTTP 409
- [ ] Step 2 `type` = `@sumeru/error`
- [ ] Step 2 `value.code` = `session_busy`
- [ ] Step 2 `value.message` = `Session is already processing a request`
- [ ] Step 3 返回 HTTP 400
- [ ] Step 3 `type` = `@sumeru/error`
- [ ] Step 3 `value.code` = `invalid_request`
- [ ] Step 3 `value.message` = `Invalid command type`
- [ ] Step 4 返回 HTTP 400
- [ ] Step 4 `type` = `@sumeru/error`
- [ ] Step 4 `value.code` = `invalid_json`
- [ ] Step 4 `value.message` = `Request body is not valid JSON`
- [ ] Step 5 返回 HTTP 404
- [ ] Step 5 `type` = `@sumeru/error`
- [ ] Step 5 `value.code` = `model_not_found`
- [ ] Step 5 `value.message` = `Model not found`
- [ ] Step 6 返回 HTTP 400
- [ ] Step 6 `type` = `@sumeru/error`
- [ ] Step 6 `value.code` = `invalid_request`
- [ ] 所有错误响应均使用 `@sumeru/error` 信封格式

## Failure Signals

- 200/202 returned instead of error → 错误校验逻辑缺失
- 500 instead of 4xx → 未捕获的异常，缺少错误处理中间件
- session_busy 未触发 → chat 处理太快，尝试更长的 prompt 或 mock 延迟
- wrong error code → 错误映射逻辑有误，检查 command dispatcher
- missing `type` field in response → 响应信封格式不符合规范
