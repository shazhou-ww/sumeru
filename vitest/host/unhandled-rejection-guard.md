---
scenario: Host 顶层捕获 unhandledRejection，不因后台异步任务异常而退出进程
feature: host-unhandled-rejection-guard
tags: [host, resilience, process, unhandled-rejection, crash, v3]
---

# Host 进程级 unhandledRejection 守卫

> 关联 issue #177：E2E 并发测试中 host 进程反复崩溃（Connection refused）。
> 根因：`main.ts` 没有 `process.on("unhandledRejection")`，任何后台
> fire-and-forget 任务（如 `readAdapterOutput` 的 `readTask`）抛出的异常
> 会冒泡为 unhandled rejection 终止整个进程。

## Given

- Host 入口为 `packages/host/src/main.ts`，通过
  `node packages/host/dist/main.js <rootDir>` 启动（参考 `deploy-systemd` 卡片）
- 进程当前**已有** `SIGINT` 处理器（优雅停止），但**没有**
  `unhandledRejection` / `uncaughtException` 处理器
- 后台存在一个被 detach 的 Promise：`session-manager.ts:476`
  ```ts
  runtime.readTask = readAdapterOutput(id, session.lines, activeSession);
  ```
  该 `readTask` 从不被 `await`，也没有 `.catch()`，是典型的
  fire-and-forget 任务

## When — 某个后台 Promise 拒绝（reject）且无人处理

- adapter 子进程异常退出后，`readAdapterOutput` 在 `catch`/`finally`
  路径上触发了一个未被捕获的 reject（详见
  `specs/host/mark-idle-missing-session-guard.md` 与
  `specs/host/adapter-abnormal-exit-resilience.md`）
- Node.js 在 event loop 上派发 `unhandledRejection` 事件

## Then — 进程存活，事件被记录而非崩溃

- `main.ts` 注册了进程级处理器：
  ```ts
  process.on("unhandledRejection", (reason) => {
    console.error("[host] unhandledRejection", reason);
  });
  ```
- 处理器**只记录日志，不调用** `process.exit()`
- HTTP 服务继续监听 `7900`，后续请求（如 `GET /`、`DELETE /sessions/:id`）
  仍返回正常响应，而不是 `Connection refused`
- 此守卫是**最后一道防线**：即使个别后台任务漏掉了 `.catch()`，
  host 也不会因单个 session 的 adapter 故障而整体宕机

---

## When — 进程收到 SIGINT（回归校验）

```bash
kill -INT <host-pid>
```

## Then — 既有优雅退出行为保持不变

- 新增 `unhandledRejection` 处理器**不影响** `SIGINT` 路径
- `started.stop()` 被调用后进程以退出码 `0` 退出
- 即新增守卫只新增「拦截未处理 reject」的能力，不改变正常生命周期

---

## Notes

- systemd 单元 `Restart=always`（`RestartSec=5`）能在崩溃后重启 host，
  但重启窗口内的请求会收到 `Connection refused`——这正是 issue #177
  在 E2E 测试中观察到的「需手动重启 / 重启后通过」现象，本守卫从根上避免它
- 处理器**不应**吞掉真正的编程错误信号：仅 `console.error` 输出 reason，
  便于在 `journalctl --user -u sumeru-v2` 中排查根因
- 该守卫与「修复具体的 reject 源头」是互补的两层防御，二者都应落地

## Code Pointers

- `packages/host/src/main.ts` — 注册 `process.on("unhandledRejection", ...)`
- `packages/host/src/session-manager.ts:476` — detach 的 `readTask` 源头
- `deploy/sumeru-v2.service` — `Restart=always` 重启策略
