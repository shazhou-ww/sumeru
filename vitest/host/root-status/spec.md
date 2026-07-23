---
scenario: 查询 Host 根状态信息
feature: host-root-status
tags: [host, status, api, health-check, happy-path]
---

# Host 根路由 — 状态查询

## Given

- Sumeru Host 已启动，监听端口 `7900`
- `host.yaml` 配置了 `name: "my-sumeru-host"`
- Host 版本号从 `package.json` 读取
- 当前有 3 个 running session，2 个 idle session，1 个 queued waiter
- Host 启动至今已过 120000 毫秒

---

## When — GET 根路径

```bash
curl http://localhost:7900/
```

## Then — 200 OK

```json
{
  "type": "@sumeru/host",
  "value": {
    "name": "my-sumeru-host",
    "version": "3.0.0",
    "status": {
      "running": 3,
      "queued": 1,
      "idle": 2
    },
    "uptime": 120000
  }
}
```

**字段说明:**
| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | Host 配置名称，来自 `host.yaml` 的 `name` 字段 |
| `version` | `string` | Sumeru Host 版本号 |
| `status.running` | `number` | 当前正在执行任务的 session 数 |
| `status.queued` | `number` | FIFO 等待队列中的 waiter 数量 |
| `status.idle` | `number` | 已完成/空闲状态的 session 数 |
| `uptime` | `number` | 自 Host 启动以来的毫秒数 |

---

## When — Host 刚启动，无 session

### Given（调整前置条件）

- Host 刚启动 500ms，无任何 session 和 waiter

```bash
curl http://localhost:7900/
```

## Then — 200 OK

```json
{
  "type": "@sumeru/host",
  "value": {
    "name": "my-sumeru-host",
    "version": "3.0.0",
    "status": {
      "running": 0,
      "queued": 0,
      "idle": 0
    },
    "uptime": 500
  }
}
```

---

## 状态计算逻辑

```
hostRoot():
  running = sessions 中 status === "running" 的数量
  idle    = sessions 中 status !== "running" 的数量
  queued  = slotWaiters 数组长度（FIFO 并发等待队列）
  uptime  = Math.max(0, Date.now() - startedAt)
```

**说明:**
- `running` / `idle` 通过遍历 sessions Map 按 status 统计
- `queued` 对应 `maxRunning` 限制下等待获取 slot 的请求数
- `uptime` 保证不为负数（`Math.max(0, ...)`）
- `startedAt` 在 `createSessionManager` 时记录 `Date.now()`

---

## Notes

- 此接口适合作为健康检查端点和监控数据源
- 响应始终为 200，即使无 session 存在
- `version` 来自 `createRootHandler` 的输入参数，由启动入口注入
- 路由处理在 `handlers/root.ts` 中，调用 `SessionManager.hostRoot()` 获取快照
