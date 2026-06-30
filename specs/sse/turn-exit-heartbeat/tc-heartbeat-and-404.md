---
id: tc-heartbeat-and-404
spec: turn-exit-heartbeat
tags: [e2e, sse, heartbeat, error, hermes]
prerequisites:
  - Sumeru host running (port 7901)
  - sumeru/hermes:dev image built from latest main
---

# SSE Heartbeat Comment & 404 on Missing Session

验证两个边界行为：(1) 长时间无事件时收到 `: heartbeat` 注释保活；(2) 请求不存在的 session 返回 404 JSON 错误而非 SSE 流。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建一个需要较长执行时间的 session（触发心跳）：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Wait 20 seconds then reply done. Use a tool that takes time if available, or just produce a very long detailed response about the history of computing.",
       "model": {"provider": "anthropic", "name": "claude-opus-4.6"}
     }' | jq -r '.value.id')
   echo "Session: $SID"
   ```

## Steps

1. 连接 SSE 流并观察至少 20 秒的输出（捕获心跳）：
   ```bash
   timeout 25 curl -s -N \
     -H 'Accept: text/event-stream' \
     "http://127.0.0.1:7901/sessions/$SID/events" > /tmp/sse-heartbeat.txt 2>&1
   echo "Done capturing"
   ```

2. 检查是否有心跳注释：
   ```bash
   grep '^: heartbeat' /tmp/sse-heartbeat.txt
   ```

3. 确认心跳不携带 id 字段（不影响 Last-Event-ID）：
   ```bash
   grep -B1 '^: heartbeat' /tmp/sse-heartbeat.txt | grep '^id:' && echo "ERROR: heartbeat has id" || echo "OK: no id before heartbeat"
   ```

4. 请求不存在的 session 的 SSE 流：
   ```bash
   curl -s -w "\nHTTP_CODE:%{http_code}" \
     -H 'Accept: text/event-stream' \
     "http://127.0.0.1:7901/sessions/ses_nonexistent_000/events"
   ```

## Expected

- [ ] Step 2 匹配到 `: heartbeat`（至少 1 次，约每 15 秒产生一次）
- [ ] Step 3 输出 "OK: no id before heartbeat"（心跳无 `id:` 行）
- [ ] Step 4 HTTP 状态码为 404
- [ ] Step 4 返回体是 JSON，包含 `error.code` = `"session_not_found"`
- [ ] Step 4 返回体包含 `error.message`（非空字符串）
- [ ] Step 4 不是 SSE 流（无 `event:` 行，Content-Type 非 text/event-stream）

## Failure Signals

- 25 秒内无心跳 → HEARTBEAT_INTERVAL_MS 可能不是 15s，或心跳 timer 未启动；检查 events handler 初始化逻辑
- Step 4 返回 200 + SSE 流 → 缺少 session 存在性检查，检查 events handler 入口
- Step 4 返回 404 但非 JSON → 错误响应格式不符合 API 规范，检查错误中间件
