---
id: turns-watch
tags: [e2e, session, turns, watch, sse, pubsub]
---

# Session Turns Watch (Subscribe-then-Pull)

`sumeru session turns <id> --watch` 实时监视 session 的 turn 变化。

## 设计

采用 subscribe-then-pull 模式避免 race condition：

1. CLI 连接 `GET /sessions/:id/turns/watch` SSE 端点
2. Server 发送 `event: connected` 握手事件，携带 `{ts: ISO timestamp}`
3. CLI 用该 timestamp 请求 `GET /sessions/:id/turns?before=<ts>` 拉取历史
4. 输出历史 turns → `---` 分隔线 → 实时流转新事件

## 端点

- `GET /sessions/:id/turns/watch` — SSE，纯 pubsub，无 replay
- `GET /sessions/:id/turns?before=<ISO>` — 历史 turns 过滤

## 事件类型

| Event | Data | 说明 |
|-------|------|------|
| `connected` | `{"ts":"<ISO>"}` | 握手，CLI 用 ts 拉历史 |
| `turn` | Turn JSON | user/assistant/tool turn |
| `exit` | ExitSignal JSON | 一次 exec 结束 |
| heartbeat (comment) | — | 每 15s 保活 |

## 行为约束

- SSE 连接**永不自动关闭**（只有 client 断开或 session 被删除）
- exit 事件只表示一次 exec 结束，不关连接
- user turn 也作为事件推送（用户 send 时触发）
