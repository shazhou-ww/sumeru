---
id: tc-reset-context
spec: session-commands
tags: [e2e, session, commands, reset, context, persona]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - Session exists and is idle
---

# Reset Session Context — With and Without Persona

验证 reset 命令清除 session 上下文，支持可选 persona 重新初始化。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建 session 并发送一些 chat 消息（制造上下文）：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"sarsapa","project":"test-reset","task":"context test"}' | jq -r '.value.id')
   ```

3. 等待 session 进入 idle 状态：
   ```bash
   curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.status'
   ```
   → 应为 `"idle"`

## Steps

### Step 1 — Reset without persona (null)

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"reset","persona":null}'
```

### Step 2 — Verify session is still accessible after reset

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value.status'
```

### Step 3 — Reset with persona

```bash
curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SID/commands \
  -H 'Content-Type: application/json' \
  -d '{"type":"reset","persona":"analyst"}'
```

### Step 4 — Verify session reflects new persona after reset

```bash
curl -s http://127.0.0.1:7901/sessions/$SID | jq '.value'
```

## Expected

- [ ] Step 1 返回 HTTP 202
- [ ] Step 1 `type` = `@sumeru/command-result`
- [ ] Step 1 `value.command` = `reset`
- [ ] Step 1 `value.status` = `accepted`
- [ ] Step 2 session 状态为 `idle` 或 `running`（reset 完成后回到 idle）
- [ ] Step 3 返回 HTTP 202
- [ ] Step 3 `type` = `@sumeru/command-result`
- [ ] Step 3 `value.command` = `reset`
- [ ] Step 3 `value.status` = `accepted`
- [ ] Step 4 session 正常可访问，persona 已更新
- [ ] reset 命令为异步响应（202，非 200）

## Failure Signals

- 404 session_not_found → Session $SID 不存在或已被销毁
- 409 session_busy → Session 正在处理其他请求，等待 idle 后重试
- 500 internal error → Context 清除失败，检查 adapter 状态
- reset 后 session 状态异常 → adapter 重新初始化失败
