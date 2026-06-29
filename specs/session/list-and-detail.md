---
scenario: 列出所有 sessions 或获取单个 session 详情
feature: session-list-and-detail
tags: [session, api, query, read-only]
---

# 列出 Sessions 与获取详情

## Given

- Sumeru Host 已启动，监听端口 `7900`
- 存在以下 sessions:
  - `ses_01J9AAAA...`：status=running, prototype=coder
  - `ses_01J9BBBB...`：status=idle, prototype=reviewer
  - `ses_01J9CCCC...`：status=running, prototype=coder

## When — 列出所有 sessions

```bash
curl http://localhost:7900/sessions
```

## Then — 200 OK

```json
{
  "type": "@sumeru/session-list",
  "value": [
    {
      "id": "ses_01J9AAAA...",
      "prototype": "coder",
      "model": {
        "provider": "anthropic",
        "name": "claude-sonnet-4-20250514",
        "apiKey": "sk-ant-..."
      },
      "image": "sumeru-coder:latest",
      "project": "my-app",
      "task": "Implement login",
      "status": "running",
      "exit": null,
      "createdAt": "2026-06-29T10:00:00.000Z"
    },
    {
      "id": "ses_01J9BBBB...",
      "prototype": "reviewer",
      "model": {
        "provider": "openai",
        "name": "gpt-4o",
        "apiKey": "sk-..."
      },
      "image": "sumeru-reviewer:latest",
      "project": "my-app",
      "task": "Review PR #42",
      "status": "idle",
      "exit": {
        "type": "complete",
        "elapsedMs": 30000,
        "turnCount": 5,
        "tokenUsage": { "input": 8000, "output": 2000, "cached": 500 },
        "message": "Review complete"
      },
      "createdAt": "2026-06-29T09:30:00.000Z"
    },
    {
      "id": "ses_01J9CCCC...",
      "prototype": "coder",
      "model": {
        "provider": "anthropic",
        "name": "claude-sonnet-4-20250514",
        "apiKey": "sk-ant-..."
      },
      "image": "sumeru-coder:latest",
      "project": "backend",
      "task": "Add auth middleware",
      "status": "running",
      "exit": null,
      "createdAt": "2026-06-29T10:05:00.000Z"
    }
  ]
}
```

---

## When — 获取单个 session 详情

```bash
curl http://localhost:7900/sessions/ses_01J9BBBB...
```

## Then — 200 OK

```json
{
  "type": "@sumeru/session",
  "value": {
    "id": "ses_01J9BBBB...",
    "prototype": "reviewer",
    "model": {
      "provider": "openai",
      "name": "gpt-4o",
      "apiKey": "sk-..."
    },
    "image": "sumeru-reviewer:latest",
    "project": "my-app",
    "task": "Review PR #42",
    "status": "idle",
    "exit": {
      "type": "complete",
      "elapsedMs": 30000,
      "turnCount": 5,
      "tokenUsage": { "input": 8000, "output": 2000, "cached": 500 },
      "message": "Review complete"
    },
    "createdAt": "2026-06-29T09:30:00.000Z"
  }
}
```

---

## When — 查询不存在的 session

```bash
curl http://localhost:7900/sessions/ses_NONEXISTENT
```

## Then — 404 Not Found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_not_found",
    "message": "Session ses_NONEXISTENT not found"
  }
}
```

---

## When — 无 sessions 时列出

```bash
curl http://localhost:7900/sessions
```

## Then — 200 OK（空数组）

```json
{
  "type": "@sumeru/session-list",
  "value": []
}
```

---

## Notes

- `GET /sessions` 返回所有 sessions 的 `SessionInfo` 数组（不含内部字段如 containerId、projectName）
- `GET /sessions/:id` 返回单个 `SessionInfo`，封装在 `@sumeru/session` envelope 中
- `SessionInfo` 字段: `id`, `prototype`, `model`, `image`, `project`, `task`, `status`, `exit`, `createdAt`
- `toSessionInfo()` 将内部 `ManagedSession` 映射为公开的 `SessionInfo`（剥离 containerId、projectName、composePath、initVersion、projectPath、sessionEnv）
- list 接口返回内存中所有 sessions，无分页
- 路由: `GET /sessions` → `sessions.list`，`GET /sessions/:id` → `sessions.detail`
