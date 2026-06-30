---
id: tc-happy-path-hello-world
spec: create-and-start
tags: [e2e, docker, smoke, hermes]
prerequisites:
  - Sumeru host running (port 7901 or configured port)
  - sumeru/hermes:dev image built from latest main
  - copilot-bridge (or compatible LLM endpoint) reachable from container
---

# Happy Path: Create Session → Agent Replies

验证最基本的端到端流程：创建 session → adapter 启动 → agent 收到 task → 回复 → session 变 idle。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回 `{"running": 0, "idle": N}` 或类似

2. 确认 Docker image 存在：
   ```bash
   docker images sumeru/hermes:dev --format '{{.ID}}'
   ```
   → 应返回非空 image ID

## Steps

1. 创建 session：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with exactly: Hello World!",
       "model": "claude-opus-4.6"
     }'
   ```
   → 记录返回的 `value.id` 为 `$SID`

2. 等待 session 完成（poll 直到 status ≠ running）：
   ```bash
   # 每 5s poll 一次，最多 2 分钟
   for i in $(seq 1 24); do
     STATUS=$(curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status')
     [ "$STATUS" != "running" ] && break
     sleep 5
   done
   echo "Final status: $STATUS"
   ```

3. 获取 session 详情：
   ```bash
   curl -s "http://127.0.0.1:7901/sessions/$SID" | jq '.value'
   ```

4. 获取 turns：
   ```bash
   curl -s "http://127.0.0.1:7901/sessions/$SID/turns" | jq '.value'
   ```

## Expected

- [ ] Step 1 返回 HTTP 201，`type` = `@sumeru/session`
- [ ] Step 1 返回的 `value.id` 以 `ses_` 开头
- [ ] Step 1 返回的 `value.status` = `running`
- [ ] Step 2 最终 status = `idle`（不是 `error`）
- [ ] Step 3 的 `exit.turnCount` ≥ 1
- [ ] Step 4 至少有 1 个 turn，role = `assistant`
- [ ] Step 4 assistant turn 的 content 包含 "Hello World"

## Failure Signals

- status 卡在 `running` 超过 2 分钟 → adapter 可能没启动，检查容器日志
- status = `error` → 查 `exit.message`，常见：API key 无效、模型名错误
- turnCount = 0 但 status = idle → ACP 通信问题，检查容器内 config.yaml
