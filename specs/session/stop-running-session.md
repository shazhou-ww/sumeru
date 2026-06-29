---
scenario: 停止正在运行的 session 使其进入 idle 状态
feature: session-stop
tags: [session, lifecycle, api, stop, exit-signal]
---

# 停止运行中的 Session

## Given

- Sumeru Host 已启动，监听端口 `7900`
- 存在一个 `status: "running"` 的 session，ID 为 `ses_01J9ABCDEF1234567890ABCDE`
- 该 session 已运行若干 turn，有 token 消耗记录

## When — 停止运行中的 session

```bash
curl -X POST http://localhost:7900/sessions/ses_01J9ABCDEF1234567890ABCDE/stop
```

## Then — 200 OK

```json
{
  "type": "@sumeru/session",
  "value": {
    "id": "ses_01J9ABCDEF1234567890ABCDE",
    "prototype": "coder",
    "model": {
      "provider": "anthropic",
      "name": "claude-sonnet-4-20250514",
      "apiKey": "sk-ant-..."
    },
    "image": "sumeru-coder:latest",
    "project": "my-app",
    "task": "Implement the login page",
    "status": "idle",
    "exit": {
      "type": "stopped",
      "elapsedMs": 45320,
      "turnCount": 7,
      "tokenUsage": {
        "input": 12500,
        "output": 3200,
        "cached": 800
      }
    },
    "createdAt": "2026-06-29T10:00:00.000Z"
  }
}
```

**状态变化:**
- `status` 从 `"running"` 变为 `"idle"`
- `exit.type` 设为 `"stopped"`
- `exit` 包含 `elapsedMs`、`turnCount`、`tokenUsage` 统计
- Adapter 进程的 stdin 被关闭（`stdin.end()`）
- Adapter runtime 从内存中移除
- 运行槽位释放，队列中的下一个 session 可启动

---

## Given — session 已经是 idle 状态

- 存在一个 `status: "idle"` 的 session，ID 为 `ses_01J9ABCDEF1234567890ABCDE`

## When — 尝试停止已 idle 的 session

```bash
curl -X POST http://localhost:7900/sessions/ses_01J9ABCDEF1234567890ABCDE/stop
```

## Then — 409 Conflict

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_already_idle",
    "message": "Session is already idle"
  }
}
```

---

## Given — session 不存在

## When — 停止不存在的 session

```bash
curl -X POST http://localhost:7900/sessions/ses_NONEXISTENT/stop
```

## Then — 404 Not Found

```json
{
  "type": "@sumeru/error",
  "value": {
    "error": "session_not_found",
    "message": "Session not found"
  }
}
```

---

## Notes

- stop 操作是同步完成的（adapter stdin 关闭即可）
- `buildStoppedExit()` 会采集当前 runtime 的 `elapsedMs`（`Date.now() - startedAt`）、`turnCount` 和 `tokenUsage`
- 如果 runtime 已不存在（异常情况），exit 中的统计值均为 0
- stop 后容器仍保持运行，session 可通过 `POST /sessions/:id/messages` 恢复执行
- 释放槽位后会唤醒 `slotWaiters` 队列中的第一个等待者
