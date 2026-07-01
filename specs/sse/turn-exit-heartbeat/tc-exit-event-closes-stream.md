---
id: tc-exit-event-closes-stream
spec: turn-exit-heartbeat
tags: [e2e, sse, streaming, lifecycle, hermes]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - sumeru/hermes:dev image built from latest main
  - copilot-bridge (or compatible LLM endpoint) reachable from container
---

# SSE Exit Event: Stream Closes After exit

验证 agent loop 完成后 SSE 流推送 `event: exit`（含 ExitSignal 数据），随后连接关闭。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建一个简单任务的 session（确保快速结束）：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with exactly: done",
       "model": {"provider": "anthropic", "name": "claude-opus-4.6"}
     }' | jq -r '.value.id')
   echo "Session: $SID"
   ```

## Steps

1. 连接 SSE 流，等待自然结束（exit 后 curl 应退出）：
   ```bash
   curl -s -N --max-time 120 \
     -H 'Accept: text/event-stream' \
     "http://127.0.0.1:7901/sessions/$SID/events" > /tmp/sse-exit.txt
   EXIT_CODE=$?
   echo "curl exit code: $EXIT_CODE"
   ```

2. 检查流中是否有 exit 事件：
   ```bash
   grep '^event: exit' /tmp/sse-exit.txt
   ```

3. 提取 exit 事件的 data：
   ```bash
   grep -A1 '^event: exit' /tmp/sse-exit.txt | grep '^data:' | sed 's/^data: //' | jq .
   ```

4. 确认 exit 是流中最后一个命名事件：
   ```bash
   grep '^event:' /tmp/sse-exit.txt | tail -1
   ```

## Expected

- [ ] Step 1 curl 正常退出（exit code 0），说明服务端关闭了连接
- [ ] Step 2 匹配到 `event: exit`
- [ ] Step 3 data 是合法 JSON，包含 `type` 字段（值为 `complete`、`failed` 等之一）
- [ ] Step 3 data 包含 `turnCount`（≥ 1）和 `tokenUsage` 对象
- [ ] Step 3 data 包含 `elapsedMs`（正整数）
- [ ] Step 4 最后一个 `event:` 行是 `event: exit`（exit 后无更多事件）
- [ ] exit 事件有 `id:` 行，值大于所有 turn 事件的 id

## Failure Signals

- curl 因 max-time 超时退出（exit code 28）→ session 未结束或 exit 事件未发送，检查 adapter 日志
- 无 `event: exit` 但有 turn 事件 → exit 信号可能未触发，检查 agent loop 是否正常结束
- `type` = `failed` → agent 执行出错，查 `message` 字段定位原因
