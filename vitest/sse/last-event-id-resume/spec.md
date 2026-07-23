---
title: SSE 断线重连 — Last-Event-ID 恢复
area: host
endpoint: GET /sessions/:id/events
header: Last-Event-ID
status: implemented
source:
  - packages/host/src/handlers/events.ts
  - packages/host/src/sse-buffer.ts
---

# SSE 断线重连：Last-Event-ID 恢复

客户端断线后以 `Last-Event-ID` 头重连，服务端从环形缓冲区重放该 ID 之后的所有事件。

---

## Scenario 1: 客户端断线后成功恢复

**Given** session `sess_abc` 已推送事件 id 1–5，客户端收到至 id 3 后断开

**When** 客户端重连携带 `Last-Event-ID: 3`：
```
GET /sessions/sess_abc/events HTTP/1.1
Accept: text/event-stream
Last-Event-ID: 3
```

**Then** 服务端：
1. 调用 `buffer.eventsAfter(3)` 获取 id 4、5 的事件
2. 依序写入这两个事件到 SSE 流
3. 更新 watermark 至 5
4. 后续新事件从 id 6 开始正常推送

重连后流内容：
```
id: 4
event: turn
data: {"id":4,"role":"assistant","content":"...","toolCalls":[],"tokenUsage":{"input":50,"output":10,"cached":0},"durationMs":200,"timestamp":"..."}

id: 5
event: turn
data: {"id":5,"role":"tool","callId":"call_001","name":"terminal","result":"...","durationMs":80,"timestamp":"..."}

```

---

## Scenario 2: 重连时 exit 已在缓冲区中

**Given** session 已结束，buffer 中 id 3 为 exit 事件，客户端 Last-Event-ID 为 2

**When** 客户端以 `Last-Event-ID: 2` 重连

**Then** 服务端重放 id 3（exit 事件）后立即调用 `res.end()` 关闭连接：
```
id: 3
event: exit
data: {"type":"complete","message":"Done","elapsedMs":3000,"turnCount":2,"tokenUsage":{"input":200,"output":80,"cached":0}}

```
- 在 replay 循环中检测到 `evt.event === "exit"` 即 `res.end(); return;`

---

## Scenario 3: Last-Event-ID 已被缓冲区淘汰 — 返回 410

**Given** 环形缓冲区容量为 1024，已写入 2000 个事件（最早 id 为 977）

**When** 客户端以 `Last-Event-ID: 500` 重连

**Then** `buffer.isExpired(500)` 返回 `true`（500 < oldestId 977），服务端返回：
```json
{
  "error": {
    "code": "sse_buffer_expired",
    "message": "Last-Event-ID is no longer in the replay buffer"
  }
}
```
HTTP 状态码 `410 Gone`。客户端应重新创建 session 或从头获取历史。

---

## Scenario 4: 无 Last-Event-ID 头 — 从头开始

**Given** session `sess_abc` 已有事件 id 1–3

**When** 客户端不带 `Last-Event-ID` 连接

**Then** `parseLastEventId()` 返回 `null`，`replayFrom` 设为 0，`eventsAfter(0)` 返回全部事件

---

## Scenario 5: Last-Event-ID 为无效值

**Given** 客户端发送 `Last-Event-ID: abc` 或 `Last-Event-ID: -1`

**When** 服务端解析该头

**Then** `parseLastEventId()` 返回 `null`（非有限正整数），等同于无 Last-Event-ID，从头重放

---

## Scenario 6: 去重 — watermark 防止重复推送

**Given** 客户端以 `Last-Event-ID: 3` 重连，replay 阶段推送了 id 4、5

**When** 订阅 live 事件后收到 buffer 中已有的 id 4（竞态情况）

**Then** 订阅回调检查 `evt.id <= watermark`（watermark=5），跳过该事件不重复写入

---

## 环形缓冲区实现细节

| 属性 | 值 |
|------|-----|
| 默认容量 | `maxSize = 1024` 个事件 |
| 数据结构 | 固定长度数组 + start/count 游标（环形覆盖） |
| ID 分配 | 全局递增 `nextId`，从 1 开始，不回绕 |
| `eventsAfter(lastId)` | 遍历有效 slots，返回 `id > lastId` 的事件 |
| `isExpired(lastEventId)` | `lastEventId < oldestId()`，count=0 或 lastEventId=0 时返回 false |
| `latest()` | 返回最新事件 ID（buffer 空时返回 0） |
