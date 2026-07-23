---
scenario: 当并发上限已满时新 session 进入 FIFO 队列等待槽位释放
feature: session-concurrency-fifo-queue
tags: [session, concurrency, queue, fifo, maxRunning]
---

# 并发控制与 FIFO 队列

## Given

- Sumeru Host 已启动，监听端口 `7900`
- `host.yaml` 配置 `maxRunning: 2`
- 已有 2 个 running sessions（`ses_01J9AAAA...` 和 `ses_01J9BBBB...`）
- 运行槽位已满

## When — 创建第三个 session（超过 maxRunning）

```bash
curl -X POST http://localhost:7900/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "prototype": "coder",
    "project": "third-project",
    "task": "Build feature X"
  }'
```

## Then — 请求挂起（等待槽位）

- HTTP 请求**不会立即返回**，而是阻塞在 `waitForRunningSlot()` 中
- session 的 Promise 被加入 `slotWaiters` 数组末尾（FIFO）
- Host root status 更新为:
  ```json
  {
    "status": {
      "running": 2,
      "queued": 1,
      "idle": 0
    }
  }
  ```

---

## When — 第一个 running session 完成（自然退出）

Adapter 输出 `done` frame → `markIdle()` 被调用:
- `ses_01J9AAAA...` 状态变为 `idle`
- `releaseRunningSlot()` 唤醒 `slotWaiters[0]`

## Then — 排队的 session 自动启动

之前挂起的请求恢复执行:
1. `generateSessionId()` 生成新 ID
2. `transport.up()` 启动容器
3. 返回 **201 Created** 响应

```json
{
  "type": "@sumeru/session",
  "value": {
    "id": "ses_01J9CCCC...",
    "prototype": "coder",
    "project": "third-project",
    "task": "Build feature X",
    "status": "running",
    "exit": null,
    "createdAt": "2026-06-29T10:10:00.000Z"
  }
}
```

Host status 变为:
```json
{
  "status": {
    "running": 2,
    "queued": 0,
    "idle": 1
  }
}
```

---

## Given — 多个请求排队

- `maxRunning: 2`，2 个 session 运行中
- 依次发起 3 个创建请求（A → B → C），均进入队列

## When — 释放一个槽位

## Then — 严格 FIFO 顺序

- `slotWaiters.shift()` 取出队列头部（请求 A）
- 请求 A 先启动并返回 201
- 请求 B 和 C 继续等待
- 下次释放槽位时，请求 B 被唤醒

---

## Given — 通过 stop 释放槽位

- `maxRunning: 2`，2 个 running session
- 1 个 session 在队列等待

## When — 手动 stop 一个 running session

```bash
curl -X POST http://localhost:7900/sessions/ses_01J9AAAA.../stop
```

## Then — 队列中的 session 被唤醒

- `stopSession()` 调用 `releaseRunningSlot()`
- 队列头部的等待者被唤醒
- 新 session 开始创建容器并启动

---

## Given — 通过 delete 释放槽位

- `maxRunning: 2`，2 个 running session
- 1 个 session 在队列等待

## When — 删除一个 running session

```bash
curl -X DELETE http://localhost:7900/sessions/ses_01J9AAAA...
```

## Then — 队列中的 session 被唤醒

- `deleteSession()` 在清理完容器后调用 `releaseRunningSlot()`
- 效果同 stop：唤醒队列头部等待者

---

## Notes

- 并发控制基于 `countRunning()` 函数，统计所有 `status === "running"` 的 session 数量
- `waitForRunningSlot()` 使用 `while` 循环 + Promise resolve 回调实现异步等待
- `slotWaiters` 是普通 Array，`push()` 入队、`shift()` 出队，保证 FIFO
- `releaseRunningSlot()` 只在 `slotWaiters.length > 0` 且 `countRunning() < maxRunning` 时唤醒
- 释放槽位的触发点：
  1. `stopSession()` — 手动停止
  2. `deleteSession()` — 删除 running session
  3. `markIdle()` — adapter 自然退出（done/suspend/error frame）
  4. `createSession()` catch 分支 — 创建失败回滚
- `submitMessage()` 也会调用 `waitForRunningSlot()`（idle→running 恢复执行时）
- 队列中的请求对 HTTP 客户端表现为长等待（long-poll），无超时机制在 host 侧
