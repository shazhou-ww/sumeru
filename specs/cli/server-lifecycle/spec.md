---
scenario: CLI server lifecycle — start, stop, and status commands for the host process
feature: CLI Server Lifecycle
tags: [cli, server, process, pid]
---

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
