---
id: tc-409-stop-idle-session
spec: standard-http-errors
tags: [e2e, errors, 409, session, conflict, docker]
prerequisites:
  - Sumeru host running (port 7901)
  - Docker daemon available
  - Prototype "echo-agent" exists with compose.yaml
---

# 409 Stop Idle Session — Conflict

验证对已处于 idle 状态的 session 执行 stop 时返回 409 session_already_idle。

## Setup

1. 创建一个 session 并等待其完成进入 idle 状态：
   ```bash
   SESSION=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H "Content-Type: application/json" \
     -d '{
       "prototype": "echo-agent",
       "project": "sumeru",
       "task": "say hello"
     }' | jq -r '.value.id')
   echo "Session: $SESSION"
   ```

2. 等待 session 进入 idle 状态（轮询）：
   ```bash
   for i in $(seq 1 30); do
     STATUS=$(curl -s http://127.0.0.1:7901/sessions/$SESSION | jq -r '.value.status')
     if [ "$STATUS" = "idle" ]; then break; fi
     sleep 2
   done
   ```

## Steps

1. 对 idle session 执行 stop：
   ```bash
   curl -s -w '\n%{http_code}' -X POST http://127.0.0.1:7901/sessions/$SESSION/stop
   ```
   → 应返回 409

2. 验证错误码：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions/$SESSION/stop | jq '.value.error'
   ```
   → 应返回 `"session_already_idle"`

## Expected

- [ ] HTTP 状态码为 409
- [ ] `.type` = `"@sumeru/error"`
- [ ] `.value.error` = `"session_already_idle"`
- [ ] `.value.message` 包含 "idle" 描述

## Failure Signals

- 返回 200 → stop 操作未检查当前状态
- 返回 404 → session 创建失败或 ID 丢失
- 返回 500 → 状态冲突检查抛出异常
- BLOCKED → Docker 不可用，无法创建 session
