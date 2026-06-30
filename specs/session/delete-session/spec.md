---
scenario: 删除 session 并清理容器和相关数据
feature: session-delete
tags: [session, lifecycle, api, cleanup, container]
---

# 删除 Session

## Given

- Sumeru Host 已启动，监听端口 `7900`
- 存在一个 session，ID 为 `ses_01J9ABCDEF1234567890ABCDE`

## When — 删除 idle 状态的 session

```bash
curl -X DELETE http://localhost:7900/sessions/ses_01J9ABCDEF1234567890ABCDE
```

## Then — 204 No Content

响应体为空。

**状态变化:**
- `transport.down()` 被调用，停止 Docker Compose 项目
- `transport.rm()` 被调用，移除容器资源
- session 从内存 Map 中移除
- adapter runtime 从内存中移除
- `recorder.clear(id)` 清理历史记录数据

---

## Given — session 正在运行

- 存在一个 `status: "running"` 的 session，ID 为 `ses_01J9RUNNING12345678901234`

## When — 删除正在运行的 session

```bash
curl -X DELETE http://localhost:7900/sessions/ses_01J9RUNNING12345678901234
```

## Then — 204 No Content

响应体为空。

**状态变化:**
- Adapter 进程先被停止（`stdin.end()` + runtime 移除）
- `transport.down()` 停止容器
- `transport.rm()` 移除容器
- session 从内存中移除
- 运行槽位释放（`releaseRunningSlot()`）
- 队列中等待的 session 获得启动机会

---

## Given — session 不存在

## When — 删除不存在的 session

```bash
curl -X DELETE http://localhost:7900/sessions/ses_NONEXISTENT
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

- 删除操作是不可逆的；历史数据（OCAS 记录）会被清除
- 无论 session 处于什么状态（running/idle），delete 都能成功
- running session 的 delete 会隐式执行 stop（关闭 adapter stdin）
- 清理顺序：stopAdapter → transport.down → transport.rm → sessions.delete → adapters.delete → recorder.clear
- 只有当被删除 session 原为 running 时才释放运行槽位
