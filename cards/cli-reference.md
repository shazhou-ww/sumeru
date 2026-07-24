---
id: cli-reference
title: "CLI Command Reference"
sources:
  - packages/cli/src/main.ts
  - packages/cli/src/setup.ts
  - packages/cli/src/image-build.ts
  - packages/cli/src/http-client.ts
tags: [sumeru, cli]
created: 2026-07-02
updated: 2026-07-02
---

# CLI Command Reference

> `sumeru` CLI wraps the Host HTTP API and local utilities. Default host: `http://127.0.0.1:7900`.

## Global Flags

| Flag | Alias | Default | Description |
|------|-------|---------|-------------|
| `--format` | — | per-command | Output format: `text`, `json`, `yaml` |
| `--host` | — | `127.0.0.1` / `$SUMERU_HOST` | Host API address (HTTP commands) |
| `--port` | — | `7900` / `$SUMERU_PORT` | Host API port (HTTP commands) |
| `--compact` | — | off | Compact JSON/YAML output |
| `--quiet` | — | off | Suppress non-essential output |
| `--help` | `-h` | — | Show command help |

## Conventions

| Topic | Rule |
|-------|------|
| Model ID | Globally unique name (e.g. `claude-sonnet-4.5`). Provider is a separate `--provider` flag on `model add`. |
| Model resolution | **session > prototype > host.yaml `defaults.model`** (session create passes `model: null` → server resolves) |
| HTTP errors | Printed as `<code>: <message>` via `HostClientError` |

## Command Tree

```
sumeru [--global-flags] <command> [subcommand] [args] [--flags]

setup
server { start | stop | status }
adapter { list | get | models }
provider { list | get | add | update | remove }
model { list | get | add | update | remove }
prototype { list | get | add | update | remove }
extension { list | get | put | remove }
persona { list | get | add | update | remove }
skill { get | put | remove }
image build
session { list | get | add | stop | remove | send | logs }
search
```

---

## setup

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru setup` | — | `--provider` **req**, `--api-key` **req**, `--model` **req**, `--api-type`, `--base-url`, `--root-dir` | Initialize `~/.sumeru`: dirs, `host.yaml`, `.env`, SQLite seed, default prototype |

---

## server

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru server start` | — | `-c` / `--config`, `--host`, `--port` | Spawn `sumeru-host` in background; write PID file |
| `sumeru server stop` | — | — | SIGTERM to PID from PID file |
| `sumeru server status` | — | `--host`, `--port` | GET `/` — name, version, running/queued/idle counts, uptime |

**Env:** `SUMERU_HOST_BIN` (default `sumeru-host`), `SUMERU_PID_FILE`.

---

## adapter

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru adapter list` | — | `--host`, `--port` | GET `/adapters` |
| `sumeru adapter get` | `<name>` | `--host`, `--port` | GET `/adapters/:name` |
| `sumeru adapter models` | `<name>` | `--host`, `--port` | GET `/adapters/:name/models` |

---

## provider

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru provider list` | — | `--host`, `--port` | GET `/providers` |
| `sumeru provider get` | `<name>` | `--host`, `--port` | GET `/providers/:name` |
| `sumeru provider add` | `<name>` | `--api-type` **req**, `--base-url` **req**, `--api-key`, `--host`, `--port` | PUT `/providers/:name` (create). `--api-type`: `anthropic` \| `openai` |
| `sumeru provider update` | `<name>` | `--api-type`, `--base-url`, `--api-key`, `--host`, `--port` | PUT `/providers/:name` (partial update) |
| `sumeru provider remove` | `<name>` | `--host`, `--port` | DELETE `/providers/:name` |

---

## model

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru model list` | — | `--provider`, `--host`, `--port` | GET `/models` (optionally filtered by provider) |
| `sumeru model get` | `<name>` | `--host`, `--port` | GET `/models/:name` |
| `sumeru model add` | `<name>` | `--provider` **req**, `--model` **req**, `--context-window`, `--host`, `--port` | PUT `/models/:name` (create) |
| `sumeru model update` | `<name>` | `--provider`, `--model`, `--context-window`, `--host`, `--port` | PUT `/models/:name` (partial update) |
| `sumeru model remove` | `<name>` | `--host`, `--port` | DELETE `/models/:name` |

---

## prototype

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru prototype list` | — | `--host`, `--port` | GET `/prototypes` |
| `sumeru prototype get` | `<name>` | `--host`, `--port` | GET `/prototypes/:name` |
| `sumeru prototype add` | `<name>` | `--model` **req**, `--adapter` **req**, `--persona` (default `default`), `--host`, `--port` | PUT `/prototypes/:name` (create) |
| `sumeru prototype update` | `<name>` | `--model`, `--adapter`, `--persona`, `--host`, `--port` | PUT `/prototypes/:name` (partial update) |
| `sumeru prototype remove` | `<name>` | `--host`, `--port` | DELETE `/prototypes/:name` |

---

## extension

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru extension list` | — | `--host`, `--port` | GET `/extensions` (table output) |
| `sumeru extension get` | `<name>` | `--host`, `--port` | GET `/extensions/:name` |
| `sumeru extension put` | `<name>` | `--dockerfile` **req**, `--description`, `--host`, `--port` | PUT `/extensions/:name` |
| `sumeru extension remove` | `<name>` | `--host`, `--port` | DELETE `/extensions/:name` |

---

## persona

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru persona list` | — | `--host`, `--port` | GET `/personas` |
| `sumeru persona get` | `<name>` | `--host`, `--port` | GET `/personas/:name` |
| `sumeru persona add` | `<name>` | `--instructions` (default `""`), `--skills` (comma-separated), `--host`, `--port` | PUT `/personas/:name` (create) |
| `sumeru persona update` | `<name>` | `--instructions`, `--skills`, `--host`, `--port` | PUT `/personas/:name` (partial update) |
| `sumeru persona remove` | `<name>` | `--host`, `--port` | DELETE `/personas/:name` |

---

## skill

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru skill get` | `<name>` | `--host`, `--port` | GET `/skills/:name` |
| `sumeru skill put` | `<name>` | `--content` **req**, `--host`, `--port` | PUT `/skills/:name` |
| `sumeru skill remove` | `<name>` | `--host`, `--port` | DELETE `/skills/:name` |

---

## image

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru image build` | `<name>` | `--agent` **req**, `--adapter`, `--host`, `--port` | Local Docker build (not Host API). Agents: `hermes`, `claude-code`, `codex`, `sarsapa`, `cursor-agent` |

---

## session

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru session list` | — | `--host`, `--port` | GET `/sessions` |
| `sumeru session get` | `<id>` | `--host`, `--port` | GET `/sessions/:id` |
| `sumeru session add` | `<prototype>` | `--project` **req**, `--task` **req**, `--env KEY=VALUE` (repeatable), `--host`, `--port` | POST `/sessions` |
| `sumeru session stop` | `<id>` | `--host`, `--port` | POST `/sessions/:id/stop` |
| `sumeru session remove` | `<id>` | `--host`, `--port` | DELETE `/sessions/:id` |
| `sumeru session send` | `<id> <message>` | `--host`, `--port` | POST `/sessions/:id/messages` |
| `sumeru session logs` | `<id>` | `-f` / `--follow`, `--host`, `--port` | GET `/sessions/:id/events` (SSE to stdout) |

---

## search

| Command | Args | Flags | Description |
|---------|------|-------|-------------|
| `sumeru search` | `<query>` | `--session`, `--host`, `--port` | GET `/search?q=...` |

---

## Environment Variables

| Variable | Default | Used by |
|----------|---------|---------|
| `SUMERU_HOST` | `127.0.0.1` | HTTP commands, `server start` |
| `SUMERU_PORT` | `7900` | HTTP commands, `server start` |
| `SUMERU_PID_FILE` | platform default | `server start/stop` |
| `SUMERU_HOST_BIN` | `sumeru-host` | `server start` |

---

## See Also

- [HTTP API Reference](./api-reference.md) — underlying REST endpoints
- [CLI Tool](./cli.md) — overview and setup flow
- [Host HTTP Service](./host-service.md) — server architecture
