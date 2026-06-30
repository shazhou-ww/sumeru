---
id: tc-list-all
spec: list-and-detail
tags: [e2e, api, read-only, session]
prerequisites:
  - Sumeru host running (port 7901)
  - At least one session exists (create one via POST /sessions first)
---

# List All Sessions

验证 `GET /sessions` 返回 `@sumeru/session-list` envelope，包含所有已知 sessions。

## Setup

1. 确认 host 存活：
   ```bash
   curl -s http://127.0.0.1:7901/ | jq '.value.status'
   ```
   → 应返回状态对象

2. 创建一个 session 确保列表非空：
   ```bash
   curl -s -X POST http://127.0.0.1:7901/sessions \
     -H 'Content-Type: application/json' \
     -d '{
       "prototype": "hermes",
       "project": "sumeru",
       "task": "Reply with: ok",
       "model": "claude-opus-4.6"
     }'
   ```
   → 记录返回的 `value.id` 为 `$SID`

## Steps

1. 列出所有 sessions：
   ```bash
   curl -s http://127.0.0.1:7901/sessions | jq .
   ```

## Expected

- [ ] HTTP 状态码 200
- [ ] 响应 `type` = `@sumeru/session-list`
- [ ] `value` 是数组且长度 ≥ 1
- [ ] 每个元素包含字段：`id`, `prototype`, `model`, `image`, `project`, `task`, `status`, `createdAt`
- [ ] 至少一个元素的 `id` = `$SID`
- [ ] `exit` 字段存在（可为 null 或对象）

## Failure Signals

- 返回 500 → host 内部异常，检查 host 日志
- `value` 不是数组 → envelope 格式变更，对照 spec
- 缺少预期字段 → `toSessionInfo()` 映射可能遗漏字段
