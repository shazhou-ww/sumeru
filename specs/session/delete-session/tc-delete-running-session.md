---
id: tc-delete-running-session
spec: delete-session
tags: [e2e, session, lifecycle, cleanup, running]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - sumeru/hermes:dev image built from latest main
  - copilot-bridge (or compatible LLM endpoint) reachable from container
---

# Delete Running Session

验证删除一个正在运行的 session 能成功：隐式停止 adapter、清理容器、释放运行槽位。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```

2. 创建一个会长时间运行的 session：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Write a 2000-word essay about the history of computing. Take your time.",
       "model": "claude-opus-4.6"
     }' | jq -r '.value.id')
   echo "Created: $SID"
   ```

3. 确认 session 处于 running 状态：
   ```bash
   sleep 3
   curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status'
   ```
   → 应返回 `running`

## Steps

1. 在 session 运行时删除它：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://127.0.0.1:7901/sessions/$SID"
   ```
   → 应返回 `204`

2. 确认 session 已不存在：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:7901/sessions/$SID"
   ```
   → 应返回 `404`

3. 确认运行槽位已释放（通过查看 host 状态）：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status.running'
   ```
   → running 数不应包含被删除的 session

## Expected

- [ ] Step 1 返回 HTTP 204
- [ ] Step 1 响应体为空
- [ ] Step 2 返回 HTTP 404（session 已从内存移除）
- [ ] Step 3 running 计数已减少（槽位释放）

## Failure Signals

- 返回 409/500 而非 204 → 删除 running session 的逻辑可能抛异常，检查 adapter 停止顺序
- 404 未出现但容器仍运行 → transport.down 可能超时，检查 Docker 容器状态
- running 计数未减少 → `releaseRunningSlot()` 未被调用，检查清理顺序
