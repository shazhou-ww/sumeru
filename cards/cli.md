---
id: cli
title: "CLI Tool"
sources:
  - packages/cli/src/cli.ts
tags: [architecture, cli, entry-point]
created: 2026-06-15
updated: 2026-06-15
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

#### Startup Sequence

1. Parse and validate `--port` (must be non-negative integer)
2. If `--config` provided: load and validate `sumeru.yaml` via `loadConfig`
   - Extracts `name`, `gateways`, `workspaceRoot`
   - Fails loudly before binding (no half-started listener)
3. Call `startServer` with:
   - Parsed config (or defaults: name="sumeru", empty gateways)
   - **Both adapters always registered**: `hermes` and `claude-code`
   - SSE defaults: null (falls through to server defaults)
   - ocas dir from `--ocas-dir` or null (server resolves via env/default)
4. Print `Listening on http://<host>:<port>`
5. Register SIGINT/SIGTERM handlers for graceful shutdown

#### Adapter Registration

The CLI always registers both adapters with default options:

```typescript
adapters: {
  hermes: createHermesAdapter({}),
  "claude-code": createClaudeCodeAdapter({}),
}
```

Gateway configs in `sumeru.yaml` reference these by adapter name. Gateways whose adapter name doesn't match a registered adapter show as `status: "unavailable"`.

#### Error Handling

| Error | Behavior |
|-------|----------|
| Invalid port | Print error, exit 1 |
| Config load failure | Print file + cause, exit 1 |
| `EADDRINUSE` | Specific message suggesting different port, exit 1 |
| Other start failure | Generic error message, exit 1 |
| Shutdown failure | Print error, exit 1 |

#### Signal Handling

Both `SIGINT` and `SIGTERM` trigger graceful shutdown:
1. Call `server.stop()` (closes HTTP listener)
2. Exit 0 on success, exit 1 on failure

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

## Shebang

```
#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
```

Suppresses Node.js experimental warnings (for `node:sqlite` and other unstable APIs used by dependencies).
