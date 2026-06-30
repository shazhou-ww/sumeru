---
title: SSE 事件流 — turn / exit / heartbeat
area: host
endpoint: GET /sessions/:id/events
accepts: text/event-stream
status: implemented
source:
  - packages/host/src/handlers/events.ts
  - packages/host/src/sse-buffer.ts
  - packages/core/src/types.ts
---

# SSE 事件流：turn / exit / heartbeat

SSE 连接只产出三种消息：`turn` 事件、`exit` 事件、心跳注释。
每个命名事件都携带递增 `id:` 字段，客户端可据此断线重连。

---

## Scenario 1: 接收 assistant turn 事件

**Given** 一个正在运行的 session `sess_abc`

**When** 客户端发起请求：
```
GET /sessions/sess_abc/events HTTP/1.1
Accept: text/event-stream
```

**Then** 服务端返回 SSE 流，assistant turn 格式如下：
```
id: 1
event: turn
data: {"id":1,"role":"assistant","content":"Hello","toolCalls":[],"tokenUsage":{"input":100,"output":20,"cached":0},"durationMs":340,"timestamp":"2026-06-29T10:00:00.000Z"}

```

- `id:` 是递增整数（从 1 开始），由 `SseBuffer.append()` 分配
- `event:` 固定为 `turn`
- `data:` 是 `Turn` 对象的 JSON 序列化（单行）

---

## Scenario 2: 接收 tool turn 事件

**Given** session `sess_abc` 正在执行 tool call

**When** tool 执行完毕产出结果

**Then** 流中推送 tool turn：
```
id: 2
event: turn
data: {"id":2,"role":"tool","callId":"call_xyz","name":"read_file","result":"{...}","durationMs":120,"timestamp":"2026-06-29T10:00:01.000Z"}

```

- `role` 为 `"tool"`，携带 `callId` 和 `name` 字段
- Turn 是判别联合体：`AssistantTurn | ToolTurn`，由 `role` 区分

---

## Scenario 3: 接收 exit 事件后连接关闭

**Given** session `sess_abc` 的 agent loop 执行完毕

**When** 服务端发送 `ExitSignal`

**Then** 流推送 exit 事件并关闭连接：
```
id: 3
event: exit
data: {"type":"complete","message":"Task done","elapsedMs":5200,"turnCount":3,"tokenUsage":{"input":500,"output":150,"cached":80}}

```

- 发送 exit 后立即调用 `res.end()` 关闭连接
- `ExitSignal.type` 可为 `complete | failed | needsInput | timeout | stopped | exhausted`

---

## Scenario 4: 心跳保活注释

**Given** 客户端已连接 SSE 流且 session 仍在运行

**When** 距上次消息已过 15 秒（`HEARTBEAT_INTERVAL_MS = 15_000`）

**Then** 服务端发送 SSE 注释：
```
: heartbeat

```

- 心跳是 SSE 注释（以 `:` 开头），不携带 `id:` 字段
- 不增加事件序号，不影响 `Last-Event-ID` 重连逻辑
- 用于防止代理/负载均衡器因空闲超时关闭连接

---

## Scenario 5: session 不存在返回 404

**Given** 不存在 session `sess_404`

**When** 客户端请求 `GET /sessions/sess_404/events`

**Then** 返回 JSON 错误（非 SSE 流）：
```json
{
  "error": {
    "code": "session_not_found",
    "message": "Session not found"
  }
}
```
HTTP 状态码 `404`。

---

## 实现要点

| 关注项 | 行为 |
|--------|------|
| 事件 ID 分配 | `SseBuffer.append()` 返回 `{ id, event, data }`，id 从 1 递增 |
| TCP_NODELAY | `res.socket?.setNoDelay(true)` — 降低延迟 |
| 资源清理 | 客户端断开 (`req.on('close')`) 时清除 heartbeat timer 和 subscription |
| exit 后清理 | 发送 exit 事件后同时 `res.end()` + `cleanup()` |
