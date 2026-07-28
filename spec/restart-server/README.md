# Server 行为规范

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
  "status": "running",
  "port": 7900,
  "version": "0.3.2",
  "sessions": { "running": 0, "queued": 0, "idle": 0 },
  "uptime": 597300
}
```

**Host 未运行时**：status 为 `"stopped"` 或 `"not_running"`。

---

## start — 启动 Host

在后台启动 Host 进程。

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |

**已在运行时**：输出包含 `already running` 提示。

---

## stop — 停止 Host

停止当前正在运行的 Host 进程。

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |

**未运行时**：输出包含 `not running` 提示。

---

## restart — 重启 Host

重启 Host 进程，等效于先 `stop` 再 `start`。重启过程中，现有 session 状态会被保留，重启后可通过 resume 恢复。

| 参数 | 类型 | 可选值 | 默认值 | 说明 |
|------|------|--------|--------|------|
| `--format` | string | yaml, json, text, html | text | 输出格式 |
| `--compact` | boolean | - | false | 紧凑输出 |
| `--quiet` | boolean | - | false | 静默模式 |
