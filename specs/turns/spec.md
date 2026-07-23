---
scenario: 列出 Session Turns 并支持分页
feature: GET /sessions/:id/turns
tags: [turns, pagination, session]
---

# 列出 Session Turns 并支持分页

> atest: [`turns-pagination.test.yaml`](./turns-pagination.test.yaml)

Session 的 Turn 列表通过 `GET /sessions/:id/turns` 获取，支持基于游标的 `?after=<id>` 分页机制。

## 背景

Turn 是 OCAS 执行过程中持久化的对话记录，每个 Turn 拥有递增整数 `id`。客户端可通过轮询 `?after=<lastSeenId>` 增量获取新 Turn。

---

## Scenario: 获取 Session 的全部 Turns

**Given** 存在一个 Session（id = `ses-abc`），其中包含 3 条 Turn 记录

**When** 发送请求：

```http
GET /sessions/ses-abc/turns
```

**Then** 响应状态码为 `200`，body 为 Turn 数组信封：

```json
{
  "turns": [
    { "id": 0, "role": "assistant", "content": "...", "toolCalls": [], "tokenUsage": {"input":100,"output":50,"cached":0}, "durationMs": 320, "timestamp": "..." },
    { "id": 1, "role": "tool", "callId": "call_1", "name": "bash", "result": "...", "durationMs": 150, "timestamp": "..." },
    { "id": 2, "role": "assistant", "content": "...", "toolCalls": [], "tokenUsage": {"input":200,"output":80,"cached":50}, "durationMs": 410, "timestamp": "..." }
  ]
}
```

---

## Scenario: 使用 `?after=<id>` 增量分页

**Given** 存在一个 Session（id = `ses-abc`），包含 id 为 0–4 的 Turn

**When** 发送请求：

```http
GET /sessions/ses-abc/turns?after=2
```

**Then** 响应状态码为 `200`，仅返回 id > 2 的 Turn：

```json
{
  "turns": [
    { "id": 3, "role": "tool", "callId": "call_2", "name": "read_file", "result": "...", "durationMs": 90, "timestamp": "..." },
    { "id": 4, "role": "assistant", "content": "...", "toolCalls": [], "tokenUsage": {"input":300,"output":120,"cached":100}, "durationMs": 500, "timestamp": "..." }
  ]
}
```

---

## Scenario: `?after` 参数非法（非整数）

**Given** 存在一个 Session（id = `ses-abc`）

**When** 发送请求：

```http
GET /sessions/ses-abc/turns?after=abc
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Query parameter 'after' must be a non-negative integer (got 'abc')"
  }
}
```

---

## Scenario: `?after` 参数为超大数（非安全整数）

**Given** 存在一个 Session（id = `ses-abc`）

**When** 发送请求：

```http
GET /sessions/ses-abc/turns?after=99999999999999999999
```

**Then** 响应状态码为 `400`：

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Query parameter 'after' must be a non-negative integer (got '99999999999999999999')"
  }
}
```

---

## Scenario: Session 不存在

**Given** 不存在 id 为 `ses-ghost` 的 Session

**When** 发送请求：

```http
GET /sessions/ses-ghost/turns
```

**Then** 响应状态码为 `404`：

```json
{
  "error": {
    "code": "session_not_found",
    "message": "Session not found"
  }
}
```

---

## User Turns

GET /sessions/:id/turns now returns user turns (role=user) in addition to assistant and tool turns.

### UserTurn type

```typescript
type UserTurn = {
  id: number;
  role: "user";
  content: string;
  timestamp: string; // ISO 8601
}
```

### Query parameter: `system=true`

Query parameter `system=true` includes system prompt turns (rendered as role=user with [system] prefix).

```http
GET /sessions/ses-abc/turns?system=true
```

When `system=true`, the system prompt is included as the first turn with `role: "user"` and content prefixed with `[system]`.

---

## 实现细节

| 行为 | 说明 |
|------|------|
| 路由 | `GET /sessions/:id/turns` |
| 分页参数 | `?after=<id>`，返回 id 严格大于该值的 Turn |
| `after` 校验 | 必须为非负整数（`/^\d+$/`），且为安全整数（`Number.isSafeInteger`） |
| Session 不存在 | 返回 `404` + `session_not_found` |
| 空 `after` | 等同于不带参数，返回全部 Turn |
| Turn 类型 | `AssistantTurn \| ToolTurn \| UserTurn`，由 `role` 区分 |
| `system` 参数 | `?system=true` 时在响应开头插入 system prompt turn |

源码参考：`packages/host/src/handlers/turns.ts`
