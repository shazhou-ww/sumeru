---
id: transport-layer
title: "Transport Layer"
sources:
  - packages/host/src/transport.ts
  - packages/host/src/types.ts
tags: [sumeru, transport]
created: 2026-06-28
updated: 2026-07-01
---

# Transport Layer

> The transport layer abstracts Docker Compose container lifecycle (`up/down/rm/exec/inspectStatus`) behind a `Transport` interface.

## Overview

All sessions in V3 run through Docker Compose. The `createDockerTransport()` function implements the `Transport` interface, which the session manager uses for container lifecycle and adapter process execution. There is no local transport — all execution happens inside containers.

## Transport Interface

```mermaid
classDiagram
  class Transport {
    +up(projectName, composePath, workDir, projectPath, env): TransportUpResult
    +down(projectName, composePath, workDir): void
    +rm(projectName, composePath, workDir): void
    +exec(containerId, command, env): TransportExecSession
    +inspectStatus(containerId): "running" | "stopped"
  }

  class TransportExecSession {
    +stdin: WritableStream
    +lines: AsyncIterable~string~
    +waitForExit(): {exitCode, stderr}
  }
```

## Docker Transport Operations

- **up**: runs `docker compose -f <compose> -p <project> up -d` with project path injected as `SUMERU_PROJECT_PATH` env var, then resolves container ID from `docker compose ps -q`.
- **down**: runs `docker compose down` in project scope.
- **rm**: runs `docker compose rm -f`.
- **exec**: spawns `docker exec -i <container> <command...>` with stdin/stdout pipes and line-buffered readline iterator.
- **inspectStatus**: runs `docker inspect -f {{.State.Running}}` and maps to `running`/`stopped`.

## Exec Session

The `exec()` method returns a `TransportExecSession` that the session manager binds to the adapter NDJSON loop:

- Writable `stdin` for sending init/message frames.
- Async iterable `lines` from stdout (one NDJSON frame per line).
- `waitForExit()` returning exit code and captured stderr.

## Default Adapter Command

Each agent type has a default entrypoint command used by exec:

```
node /opt/sumeru/<adapter>/dist/main.js
```

The session manager resolves the command based on prototype image configuration.

## Environment Injection

Transport `up` injects:
- `SUMERU_PROJECT_PATH` — resolved project directory for volume mount.
- Session-level env vars from create/message requests.
- Host-level env vars from `.env` file (loaded by compose from environment).

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/host` | `packages/host/src/types.ts` | Defines `Transport` and `TransportExecSession` contracts. |
| `@sumeru/host` | `packages/host/src/transport.ts` | Docker Compose-backed implementation. |
| `@sumeru/host` | `packages/host/src/session-manager.ts` | Consumes transport for session lifecycle and adapter exec. |

## See Also

- [Host HTTP Service](./host-service.md) — APIs that trigger transport lifecycle actions.
- [Adapter Unified I/O Contract](./adapter-contract.md) — NDJSON protocol sent over transport sessions.
- [Docker Image Build](./docker-image.md) — images executed by transport.
