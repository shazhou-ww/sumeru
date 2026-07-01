---
id: tc-with-active-sessions
spec: root-status
tags: [e2e, host, status, session-count]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - hermes prototype available
  - sumeru/hermes:dev image built
---

# Host Status — With Active Sessions

验证创建 session 后 GET / 返回的 status 计数反映实际 session 状态。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

2. 记录当前计数（可能有其他 session 在运行）：
   ```bash
   IDLE_BEFORE=$(curl -s http://127.0.0.1:7901/ | jq '.value.status.idle')
   RUNNING_BEFORE=$(curl -s http://127.0.0.1:7901/ | jq '.value.status.running')
   echo "Running before: $RUNNING_BEFORE, Idle before: $IDLE_BEFORE"
   ```

## Steps

1. 创建一个 session：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{"prototype":"hermes","project":"sumeru","task":"Reply with exactly: done"}' \
     | jq -r '.value.id')
   echo "Created: $SID"
   ```

2. 查询状态（session 可能为 running 或已完成）：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → `running + idle` 应 > `$RUNNING_BEFORE + $IDLE_BEFORE`（总 session 数增加）

3. 等待 session 完成变为 idle：
   ```bash
   for i in $(seq 1 30); do
     STATUS=$(curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status')
     [ "$STATUS" != "running" ] && break
     sleep 2
   done
   echo "Session status: $STATUS"
   ```
   → 应为 `idle`

4. 再次查询 host 状态：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → `idle` 应 > `$IDLE_BEFORE`

5. 清理 — 删除 session：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://127.0.0.1:7901/sessions/$SID"
   ```
   → 应返回 `204`

## Expected

- [ ] Step 1 创建 session 成功（返回有效 SID）
- [ ] Step 2 总 session 数增加（running + idle > 之前的总数）
- [ ] Step 3 session 最终变为 idle
- [ ] Step 4 `status.idle` 增加（相比 setup 时）
- [ ] 所有响应中 `.type` = `"@sumeru/host"`
- [ ] 所有响应中 `uptime` > 0

## Failure Signals

- running 始终为 0 → session 状态未被正确统计，检查 hostRoot() 遍历逻辑
- idle 未增加 → session 完成后状态未更新为 idle
- session 创建失败 → prototype 未配置或镜像缺失
- 返回 `prototype_no_compose` → 使用了不支持 Docker 的 prototype
