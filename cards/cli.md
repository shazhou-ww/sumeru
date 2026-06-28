---
id: cli
title: "CLI Tool"
sources:
  - packages/cli/src/main.ts
  - packages/cli/src/http-client.ts
  - packages/cli/src/format.ts
  - packages/cli/src/pid-file.ts
tags: [sumeru, cli]
created: 2026-06-28
updated: 2026-06-28
---

# CLI Tool

> `sumeru` CLI wraps host API and local process utilities for common operator workflows.

## Overview

The CLI parses a two-token command namespace (`<cmd> [sub]`) plus positional/flag arguments, then dispatches into HTTP client calls or local process actions. It uses `SUMERU_HOST`/`SUMERU_PORT` to resolve API base URL and stores host PID file for start/stop management.

Output formatting is intentionally plain text (tables and status blocks) for terminal-first operations.

## Command Surface

```mermaid
flowchart TB
  A[server start|stop|status] --> B[process + host root]
  C[prototypes] --> D[list prototypes]
  E[instances] --> F[list instances]
  G[create/delete/reset] --> H[instance lifecycle APIs]
  I[send] --> J[inbox API]
  K[logs --follow] --> L[outbox SSE stream]
  M[images] --> N[docker images sumeru/*]
```

Implemented commands in `main.ts`:

- `server start [--config <path>] [--host <host>] [--port <port>]`
- `server stop`
- `server status`
- `prototypes`
- `instances`
- `create <prototype> [--project <path>...]`
- `delete <instance_id>`
- `send <instance_id> <message>`
- `logs <instance_id> [--follow]`
- `reset <instance_id>`
- `images`

## HTTP Client Wrapper

`createHostClient()` provides typed methods:

- `getRoot`, `listPrototypes`, `listInstances`
- `createInstance`, `deleteInstance`, `resetInstance`
- `submitInbox`
- `streamOutbox` (SSE parser over fetch stream)

Error responses are mapped into `HostClientError(status, code, message)`.

## PID File Management

`server start/stop` uses PID helpers:

- default PID path: `~/.sumeru/sumeru.pid` (or `SUMERU_PID_FILE`).
- secure permission best-effort (`0700` dir, `0600` file).
- stale pid cleanup when process is not alive.
- `server start` fails if recorded PID is alive.

## Environment Variables

- `SUMERU_HOST`: API host (default `127.0.0.1`).
- `SUMERU_PORT`: API port (default `7900`).
- `SUMERU_PID_FILE`: PID file override.
- `SUMERU_HOST_BIN`: host executable used by `server start` (default `sumeru-host`).

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/cli` | `packages/cli/src/main.ts` | Argument parsing and command dispatch implementation. |
| `@sumeru/cli` | `packages/cli/src/http-client.ts` | Typed HTTP/SSE client wrapper for host API calls. |
| `@sumeru/cli` | `packages/cli/src/format.ts` | Table and status renderers for CLI output. |
| `@sumeru/cli` | `packages/cli/src/pid-file.ts` | PID file path, read/write/remove, and process-alive checks. |

## See Also

- [Host HTTP Service](./host-service.md) — API endpoints the CLI consumes.
