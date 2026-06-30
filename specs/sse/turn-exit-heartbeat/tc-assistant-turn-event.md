---
id: tc-assistant-turn-event
spec: turn-exit-heartbeat
tags: [e2e, sse, streaming, hermes]
prerequisites:
  - Sumeru host running (port 7901)
  - sumeru/hermes:dev image built from latest main
  - copilot-bridge (or compatible LLM endpoint) reachable from container
---

# SSE Turn Event: Assistant Reply Arrives as turn Event

验证创建 session 后通过 SSE 流能收到 `event: turn` 消息，且格式携带递增 `id:` 和正确的 JSON data。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

2. 创建 session 用于观察 SSE 流：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with exactly: pong",
       "model": {"provider": "anthropic", "name": "claude-opus-4.6"}
     }' | jq -r '.value.id')
   echo "Session: $SID"
   ```
   → 记录 `$SID`

## Steps

1. 连接 SSE 流并捕获输出（限时 60 秒）：
   ```bash
   curl -s -N --max-time 60 \
     -H 'Accept: text/event-stream' \
     "http://127.0.0.1:7901/sessions/$SID/events" > /tmp/sse-output.txt
   ```

2. 查看捕获的 SSE 事件：
   ```bash
   cat /tmp/sse-output.txt
   ```

3. 提取第一个 turn 事件的 data 字段：
   ```bash
   grep -A1 '^event: turn' /tmp/sse-output.txt | grep '^data:' | head -1 | sed 's/^data: //' | jq .
   ```

## Expected

- [ ] SSE 输出中包含至少一行 `event: turn`
- [ ] turn 事件之前有 `id:` 行，值为正整数（从 1 开始）
- [ ] `data:` 行是合法 JSON，包含 `role` 字段值为 `"assistant"`
- [ ] data JSON 包含 `content` 字段（非空字符串）
- [ ] data JSON 包含 `tokenUsage` 对象（含 `input`、`output` 字段）
- [ ] data JSON 包含 `durationMs`（正整数）和 `timestamp`（ISO 时间）

## Failure Signals

- curl 超时无任何输出 → session 可能未启动，检查 `GET /sessions/$SID` 的 status
- 收到 HTTP 404 → session ID 无效，确认 Step Setup.2 返回了有效 ID
- data 不是合法 JSON → 可能有多行 data（规范要求单行），检查 sse-buffer 实现
