---
scenario: adapter 子进程异常退出时 host 捕获错误并继续服务，不崩溃
feature: host-adapter-abnormal-exit-resilience
tags: [host, resilience, adapter, e2e, lifecycle, crash, v3]
---

# Adapter 异常退出后的 Host 韧性（端到端不变量）

> 关联 issue #177 的「期望」：若 adapter 子进程异常退出，host 应捕获异常
> 继续服务。这是把 #177 三个独立测试跑手观察到的崩溃现象固化为一条
> 可验证不变量。

## Given

- Host 通过 `node packages/host/dist/main.js /tmp/sumeru-e2e` 启动，监听 `7901`
- 已注册 `process.on("unhandledRejection", ...)` 守卫
  （见 `specs/host/unhandled-rejection-guard.md`）
- `markIdle` 已对缺失 session 记录做守卫
  （见 `specs/host/mark-idle-missing-session-guard.md`）
- 按 issue 复现条件：顺序创建 3-5 个 session，无需真正高并发

## When — 多 session 生命周期操作交错执行

复现 issue #177 的触发路径：

```bash
# 1) 顺序创建多个 session
for i in 1 2 3 4 5; do
  curl -X POST http://localhost:7901/sessions \
    -H "Content-Type: application/json" \
    -d "{\"prototype\":\"coder\",\"project\":\"p$i\",\"task\":\"noop\"}"
done

# 2) 等待其 adapter 进入 idle（adapter 子进程可能在此期间异常退出）

# 3) 对其中若干 session 执行 DELETE / GET，与 adapter 退出时序交错
curl -X DELETE http://localhost:7901/sessions/<id-1>
curl http://localhost:7901/sessions/<id-2>
curl -X DELETE http://localhost:7901/sessions/<id-3>
```

在此过程中，某个 adapter 子进程**异常退出**（stdout 关闭），触发
`readAdapterOutput` 的 `catch` 路径：
```ts
catch {
  const errorFrame = { type: "error",
    value: { code: "adapter_io_error", message: "adapter stdout closed" } };
  handleAdapterFrame(runtime, errorFrame, id);  // adapter 已可能被删除
  markIdle(id, errorFrame);                      // session 记录可能已删除
}
```

## Then — Host 进程存活，API 持续可用

- host 进程**不退出**：后续任一请求都返回 HTTP 响应，
  **不出现** `Connection refused`
- 对**已删除** session 的迟到 frame：`markIdle` 早返回（守卫），
  `catch` 路径整体不抛未处理异常
- `GET /` 健康检查仍返回 200，且 `status.running` 计数与实际存活 session 一致
  （异常退出的 session 不会永远停留在 `running` 而泄漏槽位）
- 即便某条后台路径仍漏抛，`unhandledRejection` 守卫兜底，进程依旧存活

---

## When — 针对 issue 中三个失败用例回归

- `specs/session/delete-session/` 系列
- `specs/sse/turn-exit-heartbeat/` 系列
- `specs/prototype/crud-lifecycle/` 系列

## Then — 不再需要「手动重启 host」

- 三组 E2E 用例可在**单个** host 进程内连续跑完，无需中途重启
- 不再出现「首次请求时 host 已崩溃，重启后才通过」的现象

---

## Notes

- 本不变量是 #177 的**验收级**场景，依赖另两条 spec 的实现：
  顶层 `unhandledRejection` 守卫 + `markIdle` 缺失记录守卫
- 触发 adapter 异常退出可在测试中以「关闭 transport stdout / 让 exec
  会话提前结束」的方式模拟，覆盖 `readAdapterOutput` 的 `catch` 与
  `finally` 两条分支
- 关联 #152（退出时不回收懒加载的 adapter 子进程树）：本 spec 聚焦
  「运行期 adapter 异常退出不致命」，与 #152 的「关停期回收」互补

## Code Pointers

- `packages/host/src/main.ts` — 进程级 `unhandledRejection` 守卫
- `packages/host/src/session-manager.ts` — `readAdapterOutput()` catch/finally、
  `markIdle()` 守卫、`deleteSession()` / `stopAdapter()` 清理
- `packages/host/src/server.ts` — `startHost()` HTTP 服务入口
