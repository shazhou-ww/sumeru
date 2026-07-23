# CLI Server Lifecycle

## Commands

| Command | 说明 |
|---------|------|
| `sumeru server start [--config <path>] [--host <addr>] [--port <port>]` | Spawn host process in background |
| `sumeru server stop` | Stop running host process |
| `sumeru server status [--host] [--port]` | Check host health |

### PID File

- Location: `~/.sumeru/host.pid` (or XDG-compliant path)
- Written on successful start
- Read/removed on stop

### Status Response 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| name | string | Host name |
| version | string | Host version |
| running | number | Running sessions count |
| queued | number | Queued sessions count |
| idle | number | Idle sessions count |
| uptime | number | Uptime in seconds |

---

## Given
- No host process is currently running
- No stale PID file exists
- SUMERU_HOST_BIN is not set (defaults to "sumeru-host")

## When — start server
```bash
sumeru server start --port 3000
```

## Then — host spawned in background
```
Host started (PID 12345) on port 3000
```
- PID file written to `~/.sumeru/host.pid`
- Process is detached from terminal

---

## Given
- Host is already running (PID file exists, process alive)

## When — start server again
```bash
sumeru server start
```

## Then — error: already running
```
Error: Host already running (PID 12345)
```

---

## Given
- Stale PID file exists (process is dead)

## When — start server
```bash
sumeru server start --port 3000
```

## Then — stale PID removed, host starts
```
Host started (PID 12346) on port 3000
```
- Stale PID file is removed before spawning

---

## Given
- Host is running on port 3000

## When — stop server
```bash
sumeru server stop
```

## Then — host stopped
```
Host stopped (PID 12345)
```
- SIGTERM sent to process
- PID file removed

---

## Given
- No host is running (no PID file)

## When — stop server
```bash
sumeru server stop
```

## Then — info message
```
No host is running
```

---

## Given
- Stale PID file exists (process dead)

## When — stop server
```bash
sumeru server stop
```

## Then — stale PID cleaned up
```
No host is running (stale PID file removed)
```

---

## Given
- Host is running on localhost:3000

## When — check status
```bash
sumeru server status
```

## Then — host info displayed
```
Name:     sumeru-host
Version:  1.0.0
Running:  2
Queued:   1
Idle:     5
Uptime:   3600s
```

---

## Given
- Host is not running

## When — check status
```bash
sumeru server status
```

## Then — connection error
```
Error: Cannot connect to host at localhost:3000
```

---

## When — start with custom config
```bash
sumeru server start --config /path/to/config.yaml --host 0.0.0.0 --port 8080
```

## Then — host started with custom options
```
Host started (PID 12347) on 0.0.0.0:8080
```

---

## When — start with SUMERU_HOST_BIN override
```bash
SUMERU_HOST_BIN=/usr/local/bin/my-host sumeru server start
```

## Then — uses custom binary
```
Host started (PID 12348) on port 3000
```

---

## Notes
- These are CLI-only commands with no HTTP API counterpart
- `start` spawns the process detached (background, not tied to terminal)
- PID file is the source of truth for whether host is "running"
- Stale PID detection: file exists but process is not alive → remove and proceed
- Uses SUMERU_HOST_BIN env var or defaults to "sumeru-host" binary
- `status` calls GET / on the host HTTP endpoint
- `--host` and `--port` on status override where to connect

---

# CLI Error Experience

## Error Handling Architecture

| Component | 说明 |
|-----------|------|
| HostClientError | Wraps connection and HTTP errors from host |
| handleClientError() | Extracts message for display |
| process.stderr | All error output goes to stderr as plain text |

### Output Format

All errors are printed as plain text to **stderr**:

```
Error: <message>
```

- No JSON envelope on errors
- No error codes prefixed
- No stack traces in normal operation

### E_USAGE Errors

For usage errors (bad command, missing required arguments), the CLI:
1. Prints `Error: <message>` to stderr
2. Also prints relevant help/usage information to **stdout**

```
Error: Missing required argument: prototype

Usage: sumeru session add <prototype> [--project <p>] [--task <t>]
```

### Version

```bash
sumeru --version   # prints version string, e.g. "0.1.0"
sumeru -v          # same as --version
```

### No Arguments (Help)

```bash
sumeru             # shows help with command descriptions to stdout
```

---

## Given
- Host is NOT running (no process on expected port)

## When — execute any command against host
```bash
sumeru session list
```

## Then — friendly connection error (not raw ECONNREFUSED)
```
Error: Cannot connect to host at 127.0.0.1:7900
```
- Output goes to stderr
- No stack trace
- No raw Node.js error
- HostClientError wraps the connection failure

---

## When — execute prototype list against dead host
```bash
sumeru prototype list
```

## Then — same friendly error
```
Error: Cannot connect to host at 127.0.0.1:7900
```

---

## Given
- Host is running and healthy

## When — reference nonexistent session
```bash
sumeru session get nonexistent-id
```

## Then — session_not_found error
```
Error: Session not found
```
- No stack trace
- Clean single-line output to stderr

---

## When — reference nonexistent prototype
```bash
sumeru prototype get nonexistent
```

## Then — prototype_not_found error
```
Error: Prototype not found
```

---

## When — missing required argument for session add
```bash
sumeru session add
```

## Then — usage hint (E_USAGE)
stderr:
```
Error: Missing required argument: prototype
```
stdout:
```
Usage: sumeru session add <prototype> [--project <p>] [--task <t>]
```
- No crash, no stack trace

---

## When — missing required argument for prototype add
```bash
sumeru prototype add
```

## Then — usage hint (E_USAGE)
stderr:
```
Error: Missing required argument: name
```
stdout:
```
Usage: sumeru prototype add <name>
```

---

## When — invalid model ID format in model command
```bash
sumeru session model sess-001 invalid-format
```

## Then — format error
```
Error: Invalid model ID "invalid-format". Expected format: provider:name
```

---

## When — model command with nonexistent model
```bash
sumeru session model sess-001 fake:nonexistent
```

## Then — model_not_found error
```
Error: Model not found
```

---

## When — nonexistent subcommand
```bash
sumeru session bogus
```

## Then — help suggestion (E_USAGE)
stderr:
```
Error: Unknown command: bogus
```
stdout:
```
Available commands: list, add, send, turns, logs, stop, remove, exec, reset, snapshot, model
```

---

## When — network timeout
```bash
sumeru session list
```

## Then — timeout error (not raw error)
```
Error: Request timed out connecting to host at 127.0.0.1:7900
```

---

## When — sumeru with no arguments
```bash
sumeru
```

## Then — help output to stdout
```
Usage: sumeru <command> [options]

Commands:
  server    Manage the host server process
  adapter   View available adapters
  provider  Manage LLM providers
  model     Manage model configurations
  prototype Manage session prototypes
  persona   Manage personas
  session   Manage and interact with sessions
  search    Search session content

Options:
  --version, -v  Show version
  --help, -h     Show help
```

---

## When — sumeru --version
```bash
sumeru --version
```

## Then — version string to stdout
```
0.1.0
```

---

## Notes
- All CLI errors output plain text to stderr: `Error: <message>`
- No JSON envelope on error output
- E_USAGE errors (bad command, missing args) additionally print relevant help to stdout
- `sumeru --version` / `-v` prints version string to stdout
- `sumeru` (no args) shows help with command descriptions to stdout
- HostClientError wraps both connection errors and HTTP error responses
- Missing arguments trigger E_USAGE with help output
- Connection errors (ECONNREFUSED, ETIMEDOUT) are caught and wrapped
- HTTP error responses (4xx, 5xx) extract the error message from the response body
- The goal is: users never see raw Node.js errors or stack traces in normal operation

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