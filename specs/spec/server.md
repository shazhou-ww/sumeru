# Server 行为规范

> atest: (no dedicated test.yaml — covered by smoke suite via session-lifecycle)

Sumeru Host 是后台常驻进程，提供 HTTP API。CLI 通过 `sumeru server` 子命令管理其生命周期。

## 子命令总览

| CLI 子命令 | 说明 |
|-----------|------|
| `sumeru server start [--port <port>]` | 启动 host 后台进程 |
| `sumeru server stop` | 停止运行中的 host |
| `sumeru server restart` | 重启 host（stop + start） |
| `sumeru server status` | 查询 host 状态 |

---

## status — 查询状态

```
$ sumeru server status
Status: running
Port: 7900
Version: 0.3.2
Sessions: running=0 queued=0 idle=0
Uptime: 165h 45m
```

**API** `GET /` 返回 JSON：

```json
{
  "type": "@sumeru/host",
  "value": {
    "status": "running",
    "port": 7900,
    "version": "0.3.2",
    "sessions": { "running": 0, "queued": 0, "idle": 0 },
    "uptime": "165h 45m"
  }
}
```

**Error** 如果 host 未运行，输出连接错误。

---

## start — 启动 host

```
sumeru server start [--port <port>]
```

**Behavior**
1. 检查 PID file（`~/.sumeru/host.pid`）
2. 如果已有进程运行 → 报错 `Host already running`
3. 如果 PID file 存在但进程已死（stale PID）→ 清理后启动
4. Spawn 后台进程，写入 PID file

**Output** `Host started on port 7900`

---

## stop — 停止 host

```
$ sumeru server stop
Host stopped.
```

**Behavior**
1. 读取 PID file，发送 SIGTERM
2. 等待进程退出
3. 删除 PID file

**Error** `No host is running` — 无运行中的进程。

---

## restart — 重启 host

```
$ sumeru server restart
Server restarted.
```

**Behavior** stop + start。Session 状态保留在 Docker container 中不受影响。

---

## Lazy Start

CLI 命令执行时如果 host 未运行，自动启动（lazy start）。用户不需要手动 `server start`。

---

## PID File

- 位置：`~/.sumeru/host.pid`
- 内容：进程 PID（纯数字）
- 生命周期：start 时写入，stop 时删除
- Stale 检测：文件存在但进程不存活 → 自动清理

---

## Error Handling

所有 CLI 错误以纯文本输出到 stderr：

```
Error: <message>
```

- 连接失败（ECONNREFUSED）→ `Cannot connect to host`
- HTTP 错误响应 → 提取 error message 显示
- 用法错误（缺参数）→ 错误信息 + help 提示

**注意** 不会输出 JSON envelope、stack trace 或原始 Node.js 错误。
