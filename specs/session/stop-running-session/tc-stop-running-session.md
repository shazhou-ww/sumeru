---
id: tc-stop-running-session
spec: stop-running-session
tags: [e2e, session, lifecycle, stop]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - sumeru/hermes:dev image built from latest main
---

# Stop Running Session

验证对一个 running 状态的 session 执行 POST /sessions/:id/stop 返回 200，status 变为 idle，exit.type 为 stopped。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

2. 创建一个 session（使用较长任务保持 running 状态）：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Write a very long essay about the history of computing from 1940 to 2025, covering every decade in detail"
     }' | jq -r '.value.id')
   echo "Created: $SID"
   ```

3. 等待 session 进入 running 状态：
   ```bash
   for i in $(seq 1 20); do
     STATUS=$(curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status')
     [ "$STATUS" = "running" ] && break
     sleep 2
   done
   echo "Status: $STATUS"
   ```
   → 应为 `running`

## Steps

1. 停止 session：
   ```bash
   RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "http://127.0.0.1:7901/sessions/$SID/stop")
   HTTP_CODE=$(echo "$RESPONSE" | tail -1)
   BODY=$(echo "$RESPONSE" | sed '$d')
   echo "HTTP: $HTTP_CODE"
   echo "$BODY" | jq .
   ```
   → HTTP 应返回 `200`

2. 验证响应中 status 为 idle：
   ```bash
   echo "$BODY" | jq -r '.value.status'
   ```
   → 应为 `idle`

3. 验证 exit.type 为 stopped：
   ```bash
   echo "$BODY" | jq -r '.value.exit.type'
   ```
   → 应为 `stopped`

4. 验证 exit.elapsedMs > 0：
   ```bash
   echo "$BODY" | jq '.value.exit.elapsedMs'
   ```
   → 应大于 0

5. 验证 exit.turnCount >= 0：
   ```bash
   echo "$BODY" | jq '.value.exit.turnCount'
   ```
   → 应大于等于 0

## Expected

- [ ] Step 1 返回 HTTP 200
- [ ] Step 2 status = `idle`
- [ ] Step 3 exit.type = `stopped`
- [ ] Step 4 exit.elapsedMs > 0
- [ ] Step 5 exit.turnCount >= 0

## Failure Signals

- 返回 404 → session 创建失败或 ID 不正确
- 返回 409 → session 已在 stop 前变为 idle（任务太短）
- status 仍为 running → stop 操作未生效，检查 adapter stdin.end() 逻辑
- exit.type 不是 stopped → buildStoppedExit() 未被正确调用
