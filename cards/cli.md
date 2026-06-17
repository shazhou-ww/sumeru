---
id: cli
title: "CLI Tool"
sources:
  - packages/cli/src/cli.ts
  - packages/cli/src/build-adapters.ts
  - packages/cli/src/pid-file.ts
  - packages/cli/src/port-check.ts
tags: [architecture, cli, entry-point]
created: 2026-06-15
updated: 2026-06-17
---

# CLI Tool

`@sumeru/cli` is the entry point binary (`sumeru`) built with Commander.js. It exposes the `start` command for launching the HTTP server and placeholder commands for planned features.

## Commands

### sumeru start (implemented)

Starts the Sumeru HTTP server with adapter registration.

```
sumeru start [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `-p, --port <number>` | `7900` | TCP port (0 = ephemeral) |
| `-h, --host <host>` | `127.0.0.1` | Bind address |
| `-c, --config <path>` | (none) | Path to `sumeru.yaml` |
| `--ocas-dir <path>` | `$SUMERU_OCAS_DIR` or `~/.sumeru/ocas` | CAS store directory |
| `--force` | (none) | Kill any process holding the port before binding (SIGTERM, then SIGKILL after 2s) |

#### Startup Sequence

1. Parse and validate `--port` (must be non-negative integer)
2. If `--config` provided: load and validate `sumeru.yaml` via `loadConfig`
   - Extracts `name`, `gateways`, `workspaceRoot`
   - Fails loudly before binding (no half-started listener)
3. **PID file lifecycle** (issue #33):
   - Check `~/.sumeru/sumeru.pid` (or `$SUMERU_PID_FILE`)
   - If pid file exists and process is alive:
     - With `--force`: kill the process (SIGTERM → SIGKILL after 2s)
     - Without `--force`: error and exit 1
   - If pid file exists but process is dead: remove stale file
   - Write current process.pid to pid file
4. Call `startServer` with:
   - Parsed config (or defaults: name="sumeru", empty gateways)
   - Adapters built via `buildAdapters(gateways)` — dynamically registers only those referenced in config
   - SSE defaults: null (falls through to server defaults)
   - ocas dir from `--ocas-dir` or null (server resolves via env/default)
5. If `EADDRINUSE` and `--force`: kill port holder, retry bind once
6. Print `Listening on http://<host>:<port>`
7. Register SIGINT/SIGTERM handlers for graceful shutdown (removes pid file on exit)

#### Adapter Registration

The CLI uses `buildAdapters()` (from `build-adapters.ts`) to construct the adapter registry from the parsed gateway config:

```typescript
adapters: buildAdapters(args.gateways)
```

`buildAdapters()` walks the `gateways` map and dispatches on `gw.adapter` to the matching factory:
- `"hermes"` → `createHermesAdapter(opts)`
- `"claude-code"` → `createClaudeCodeAdapter(opts)`

Each gateway's `gw.config` blob is forwarded verbatim to the factory; absent/`null` blobs become `{}`. Unknown adapter names are **silently skipped** — the gateway then shows as `status: "unavailable"` via `GET /gateways`. The CLI does NOT crash on unbundled adapters.

#### Error Handling

| Error | Behavior |
|-------|----------|
| Invalid port | Print error, exit 1 |
| Config load failure | Print file + cause, exit 1 |
| Existing pid + alive process (no `--force`) | Print error suggesting `--force`, exit 1 |
| `EADDRINUSE` | Use `lsof` to identify port holder, print diagnostic with `--force` hint, exit 1 |
| Other start failure | Generic error message, exit 1 |
| Shutdown failure | Print error, exit 1 |
| PID file write failure | Best-effort warning, continue startup |

#### Signal Handling

Both `SIGINT` and `SIGTERM` trigger graceful shutdown:
1. Call `server.stop()` (closes HTTP listener)
2. Remove pid file (`~/.sumeru/sumeru.pid`)
3. Exit 0 on success, exit 1 on failure
4. Second signal during shutdown: exit immediately (escape hatch for hung shutdown)

### sumeru run (planned)

```
sumeru run -s <scene> -r <runner> -m <model> [options]
```

Planned Docker-based scene execution. Currently prints options and returns.

| Option | Description |
|--------|-------------|
| `-s, --scene <path>` | Scene directory or YAML (required) |
| `-r, --runner <type>` | Adapter type: hermes, claude-code (required) |
| `-m, --model <model>` | Model identifier (required) |
| `-t, --timeout <seconds>` | Timeout (default 300) |
| `--network / --no-network` | Network access (default true) |
| `-i, --image <image>` | Docker image |
| `-o, --output <path>` | Recording output path |

### sumeru list (planned)

```
sumeru list [-d <dir>]
```

Planned scene listing. Currently prints the directory and returns.

## Version Discovery

`findVersion()` walks up from the CLI source file looking for `package.json` with `name: "@sumeru/cli"` (up to 5 directories). Falls back to `"0.0.0"` if not found.

## Modules

### build-adapters.ts

Builds the adapter registry from parsed gateway config.

**Core Function:**
```typescript
function buildAdapters(
  gateways: Record<string, GatewayConfig>,
  factories: AdapterFactoryMap = DEFAULT_ADAPTER_FACTORIES,
): Record<string, Adapter>
```

- Walks `gateways` map, dispatches on `gw.adapter` to matching factory
- Forwards `gw.config` blob verbatim to factory (`null` → `{}`)
- Unknown adapter names are **silently skipped** (no crash)
- Default factories: `{ hermes, "claude-code" }`

**Design:** Issue #32 — gateway.config forwarding. Each gateway's `config:` block in YAML passes through to the adapter factory without server-side validation.

### pid-file.ts

Best-effort PID file management (issue #33).

**Key Functions:**
- `resolvePidFilePath()` — `$SUMERU_PID_FILE` or `~/.sumeru/sumeru.pid`
- `writePidFile(path, pid)` — writes `<pid>\n` with mode 0o600, creates parent dir (0o700)
- `readPidFile(path)` — returns parsed pid or `null` if missing/malformed
- `removePidFile(path)` — no-op if already absent
- `isProcessAlive(pid)` — uses `process.kill(pid, 0)` (no signal sent) to probe liveness
  - `ESRCH` → dead
  - `EPERM` → live but foreign (treated as live for safety)

### port-check.ts

Port conflict detection + force-kill helpers (issue #33).

**Key Functions:**
- `lookupPortHolder(host, port)` — shells out to `lsof -i :<port> -sTCP:LISTEN -t -P -n`
  - Returns `{ pid, command }` or `null` if lsof missing/no holder/error
- `formatPortInUse({ host, port, holder })` — operator-facing error message with `--force` hint
- `killHolder(pid, port, host)` — SIGTERM, wait 2s for port to free, then SIGKILL
  - Throws on permission errors (e.g. EPERM)

## Shebang

```
#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
```

Suppresses Node.js experimental warnings (for `node:sqlite` and other unstable APIs used by dependencies).
