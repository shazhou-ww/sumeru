---
id: tc-delete-idle-session
spec: delete-session
tags: [e2e, session, lifecycle, cleanup]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - sumeru/hermes:dev image built from latest main
---

# Delete Idle Session

验证删除一个已完成（idle）的 session 返回 204 且后续查询返回 404。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

2. 创建一个 session 并等待其变为 idle：
   ```bash
   SID=$(curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with exactly: done",
       "model": "claude-opus-4.6"
     }' | jq -r '.value.id')
   echo "Created: $SID"
   ```

3. 等待 session 完成：
   ```bash
   for i in $(seq 1 24); do
     STATUS=$(curl -s "http://127.0.0.1:7901/sessions/$SID" | jq -r '.value.status')
     [ "$STATUS" != "running" ] && break
     sleep 5
   done
   echo "Status: $STATUS"
   ```
   → 应为 `idle`

## Steps

1. 删除 session：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://127.0.0.1:7901/sessions/$SID"
   ```
   → 应返回 `204`

2. 确认 session 已不存在：
   ```bash
   curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:7901/sessions/$SID"
   ```
   → 应返回 `404`

3. 验证 404 响应体：
   ```bash
   curl -s "http://127.0.0.1:7901/sessions/$SID" | jq '.value.error'
   ```
   → 应返回 `"session_not_found"`

## Expected

- [ ] Step 1 返回 HTTP 204
- [ ] Step 1 响应体为空
- [ ] Step 2 返回 HTTP 404
- [ ] Step 3 error 字段 = `"session_not_found"`

## Failure Signals

- 返回 200 而非 204 → 路由可能未正确匹配 DELETE 方法
- 删除后仍能查到 session → session 未从内存 Map 中移除，检查 SessionManager.delete 逻辑
- 容器仍在运行 → transport.down/rm 未被调用，检查 Docker ps
