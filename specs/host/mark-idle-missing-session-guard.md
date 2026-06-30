---
scenario: markIdle 对已删除/不存在的 session 记录安全返回，不抛异常
feature: host-mark-idle-missing-session-guard
tags: [host, session, lifecycle, markIdle, guard, race-condition, v3]
---

# markIdle 缺失 session 记录守卫

> 关联 issue #177：顺序操作 3-5 个 session（创建 → 等待 idle →
> DELETE / GET）后 host 崩溃。竞态在于 adapter 子进程的 outbox frame
> 与 session 删除之间存在时间差：frame 到达时 session 记录可能已被
> `deleteSession` / `stopAdapter` 清除。

## Given

- 存在一个 running session `ses_01J9AAAA...`，其 adapter 子进程已启动
- 后台 `readAdapterOutput(id, ...)` 正在消费该 adapter 的 stdout
- `markIdle(id, frame)` 会在两处被后台任务调用（`session-manager.ts`）：
  - 收到 `done` / `suspend` / `error` frame 时（正常退出路径）
  - `readAdapterOutput` 的 `catch` 块（adapter stdout 异常关闭）
- 关键不变量：`markIdle` 可能在 `sessions.delete(id)` **之后**才被触发

## When — session 已被删除后，markIdle 仍被调用

```text
1. 客户端 DELETE /sessions/ses_01J9AAAA...
   → deleteSession(): stopAdapter(id) → sessions.delete(id) → adapters.delete(id)
2. 几乎同时，adapter 子进程退出，readAdapterOutput 的 catch 块触发：
   → handleAdapterFrame(runtime, errorFrame, id)
   → markIdle(id, errorFrame)   // 此时 sessions.get(id) === undefined
```

## Then — markIdle 安全早返回，不抛异常

- `markIdle` 开头即守卫：
  ```ts
  const record = sessions.get(id);
  if (record === undefined || record.status !== "running") {
    return;
  }
  ```
- `record === undefined`（已删除）时**直接 return**，不再访问
  `record.*`，不调用 `sessions.set(...)`，不调用 `releaseRunningSlot()`
- 因此**不会**因为 `record` 为 `undefined` 抛 `TypeError`，
  也就不会产生 unhandled rejection（参见
  `specs/host/unhandled-rejection-guard.md`）
- 已是非 `running` 状态（如已 `idle`）时同样早返回，保证幂等：
  重复的退出 frame 不会二次释放槽位

---

## When — session 存在且处于 running（正常路径回归）

- `markIdle(id, doneFrame)`，且 `sessions.get(id).status === "running"`

## Then — 正常落地 idle 状态

- 写入 `status: "idle"`，并依据 frame 计算 `exit`（complete/stopped/...）
- 调用一次 `releaseRunningSlot()` 唤醒 FIFO 队列中的 waiter
- 守卫**不改变**这条 happy-path 行为，仅拦截记录缺失/状态不符的情形

---

## Notes

- `markIdle` 的守卫保护「读取记录字段」这一步；但 `markIdle` 之前还会先调用
  `handleAdapterFrame(runtime, frame, id)`，后者操作的是 `runtime`（adapter
  侧）而非 `sessions` 记录。完整修复需保证：在 session/adapter 记录已被清理
  的情况下，整条 `catch` 路径都不抛——这一端到端不变量由
  `specs/host/adapter-abnormal-exit-resilience.md` 覆盖
- 该守卫是 issue #177 修复中「guard markIdle against missing session
  records」的直接落点

## Code Pointers

- `packages/host/src/session-manager.ts` — `markIdle()` 守卫
- `packages/host/src/session-manager.ts` — `readAdapterOutput()` 的 `catch` 块
- `packages/host/src/session-manager.ts` — `deleteSession()` / `stopAdapter()`
  执行 `sessions.delete` / `adapters.delete`
