---
id: tc-list-empty
spec: list-and-detail
tags: [e2e, api, edge-case, session]
prerequisites:
  - "[e2e-prerequisites](../../e2e-prerequisites.md) 已完成"
  - Host running on port 7901
  - No sessions exist (fresh host start or all sessions cleared)
---

# List Empty: No Sessions Returns Empty Array

验证无 sessions 时 `GET /sessions` 返回空数组而非 null 或 404。

## Setup

1. 启动一个全新的 host 实例（无残留 sessions），或确认当前无 sessions：
   ```bash
   curl -s http://127.0.0.1:7901/sessions | jq '.value | length'
   ```
   → 应返回 `0`（如果非零，需重启 host 或等待所有 sessions 清理完毕）

## Steps

1. 列出 sessions：
   ```bash
   curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:7901/sessions
   ```

2. 获取完整响应体：
   ```bash
   curl -s http://127.0.0.1:7901/sessions | jq .
   ```

## Expected

- [ ] Step 1 HTTP 状态码 = 200（不是 404 或 204）
- [ ] Step 2 响应 `type` = `@sumeru/session-list`
- [ ] `value` 是数组
- [ ] `value` 长度 = 0（空数组 `[]`，不是 `null`）

## Failure Signals

- 返回 404 → 路由可能在空列表时错误地返回 not found
- `value` = `null` → 序列化 bug，应始终返回 `[]`
- 返回 204 No Content → 不符合 envelope 约定，应返回 200 + 空 envelope
