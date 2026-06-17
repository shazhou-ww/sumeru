---
id: cli-utilities
title: "CLI Utilities: PID File and Port Check"
sources:
  - packages/cli/src/pid-file.ts
  - packages/cli/src/port-check.ts
tags: [cli, utilities, process-management]
created: 2026-06-17
updated: 2026-06-17
---

# CLI Utilities: PID File and Port Check

CLI 包含两个进程管理工具模块，支持 `sumeru start` 的单实例保证和端口冲突处理（issue #33）。详细用法见 [CLI card](./cli.md)。

## pid-file.ts

Best-effort PID 文件管理，防止多实例同时运行。

### Key Functions

- `resolvePidFilePath()` — 解析 PID 文件路径：`$SUMERU_PID_FILE` 或 `~/.sumeru/sumeru.pid`
- `writePidFile(path, pid)` — 写入 `<pid>\n`，mode 0o600，创建父目录（mode 0o700）
- `readPidFile(path)` — 读取并解析 PID，返回 `number | null`（容忍缺失/格式错误）
- `removePidFile(path)` — 删除 PID 文件，已删除时为 no-op
- `isProcessAlive(pid)` — 使用 `process.kill(pid, 0)` 探测进程存活
  - `ESRCH` → 进程不存在 → `false`
  - `EPERM` → 进程存在但属于其他用户 → `true`（安全起见，视为存活）

### Startup Flow

1. 读取 PID 文件
2. 如果 PID 存在且进程存活：
   - 有 `--force` → kill 进程（SIGTERM → SIGKILL after 2s）
   - 无 `--force` → 报错退出
3. 如果 PID 存在但进程已死 → 删除过时文件
4. 写入当前 `process.pid`
5. Server 关闭时删除 PID 文件

## port-check.ts

端口冲突检测和强制 kill 功能。

### Key Functions

- `lookupPortHolder(host, port)` — 通过 `lsof -i :<port> -sTCP:LISTEN -t -P -n` 识别端口持有者
  - 返回 `{ pid, command }` 或 `null`（lsof 缺失/无持有者/错误）
- `formatPortInUse({ host, port, holder })` — 生成操作员可读的错误消息，包含 `--force` 提示
- `killHolder(pid, port, host)` — SIGTERM → 等待 2s 端口释放 → SIGKILL
  - 权限错误（EPERM）会 throw，调用者处理

### Error Messages

#### lsof 可用时

```
Port 7900 is already in use on 127.0.0.1.
  Held by pid 12345 (node)
  Run `sumeru start --port 7900 --force` to terminate it, or pick a different --port.
```

#### lsof 不可用时

```
Port 7900 is already in use on 127.0.0.1. Choose a different --port or stop the conflicting process.
```

### --force Behavior

1. 尝试启动 → `EADDRINUSE`
2. 查找端口持有者（lsof）
3. 如果找到 → `killHolder(pid, port, host)`
4. 重试绑定一次

## Design Considerations

- **Best-effort PID file** — 写入失败不阻止启动，仅记录警告
- **Graceful kill** — 先 SIGTERM 给进程清理机会，2s 后才 SIGKILL
- **Safety**: `isProcessAlive` 对 `EPERM`（外部进程）返回 `true`，避免覆盖他人的 PID 文件
- **No crash on missing lsof** — `lookupPortHolder` 始终返回结果或 `null`，never throw

## See Also

- [CLI card](./cli.md) — 完整的 CLI 文档，包含这些工具在启动流程中的集成
- `specs/cli-pid-file.md` — PID 文件设计文档
- `specs/cli-startup-port-check.md` — 端口检查设计文档
