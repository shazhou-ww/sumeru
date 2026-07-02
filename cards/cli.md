---
id: cli
title: "CLI Tool"
sources:
  - packages/cli/src/main.ts
  - packages/cli/src/setup.ts
  - packages/cli/src/image-build.ts
  - packages/cli/src/http-client.ts
  - packages/cli/src/pid-file.ts
tags: [sumeru, cli]
created: 2026-06-28
updated: 2026-07-01
---

# CLI Tool

> `sumeru` CLI wraps host API and local utilities for setup, image build, prototype management, session control, and server lifecycle.

## Overview

The CLI parses a two-token command namespace (`<cmd> [sub]`) plus positional/flag arguments, then dispatches into HTTP client calls, local process actions, or offline setup routines. It uses `SUMERU_HOST`/`SUMERU_PORT` to resolve API base URL.

## Command Surface

```mermaid
flowchart TB
  A[setup] --> A1[init ~/.sumeru + SQLite + image + prototype]
  B[server start|stop|status] --> B1[process + host root]
  C[prototype list|add|remove] --> C1[prototype CRUD via API]
  D[provider list|add|remove] --> D1[provider CRUD via API]
  E[model list|add|remove] --> E1[model CRUD via API]
  F[image build|list] --> F1[Docker build + image registry]
  G[sessions] --> G1[list sessions]
  H[create/delete/stop/send/logs] --> H1[session lifecycle APIs]
```

## Setup Command

`sumeru setup --provider <name> --api-key <key> --model <model-name> [--api-type <type>] [--base-url <url>] [--root-dir <path>]`

Performs one-shot initialization:

1. Creates `~/.sumeru` directory tree (data/, prototypes/, workspace/).
2. Writes `host.yaml` (create-only, never overwrites).
3. Upserts `.env` with provider API key.
4. Seeds SQLite: Provider → Model → Persona ("default").
5. Creates `data/prototypes/sarsapa.yaml` and `prototypes/sarsapa/compose.yaml`.
6. Builds the sarsapa Docker image (best-effort, skipped if not in repo).
7. Writes `images.yaml` with built image metadata.

Known providers (auto-detect apiType + baseUrl): `anthropic`, `openai`, `openrouter`, `siliconflow`, `deepseek`. Custom providers require `--api-type` and `--base-url`.

Setup is **idempotent** — re-running upserts provider/model/env without breaking existing config.

## Image Build Command

`sumeru image build <name> --agent <type> [--adapter <pkg-or-path>]`

- Supported agents: `hermes`, `claude-code`, `codex`, `sarsapa`, `cursor-agent`.
- Copies dist artifacts (core + adapter-core + agent adapter) into `.build/` staging dir.
- Runs `docker build` with agent-specific Dockerfile from `packages/adapter-<agent>/Dockerfile`.
- Registers image in host via `POST /images/:name` (or writes `images.yaml` locally during setup).
- Tag convention: `sumeru/<name>:dev` for local builds.

`sumeru image list` — lists registered images from host API.

## Prototype Commands

- `sumeru prototype list` — list prototypes via API.
- `sumeru prototype add <name> --model <model-id> --image <image-name> [--persona <name>]`
- `sumeru prototype remove <name>`

## Provider / Model Commands

- `sumeru provider list|add|remove` — CRUD for providers.
- `sumeru model list|add|remove` — CRUD for models.

## Session Commands

- `sumeru sessions` — list all sessions.
- `sumeru create <prototype> --project <path> --task <description>`
- `sumeru delete <session_id>` / `sumeru stop <session_id>`
- `sumeru send <session_id> <message>`
- `sumeru logs <session_id> [--follow]` — SSE event stream.

## HTTP Client

`createHostClient()` provides typed methods for all host API endpoints. Uses `fetch` with JSON envelope parsing. Error responses are mapped into `HostClientError(status, code, message)`.

## Environment Variables

- `SUMERU_HOST`: API host (default `127.0.0.1`).
- `SUMERU_PORT`: API port (default `7900`).
- `SUMERU_PID_FILE`: PID file override.
- `SUMERU_HOST_BIN`: host executable for `server start` (default `sumeru-host`).

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/cli` | `packages/cli/src/main.ts` | Argument parsing and command dispatch. |
| `@sumeru/cli` | `packages/cli/src/setup.ts` | Offline setup: dir creation, SQLite seeding, image build. |
| `@sumeru/cli` | `packages/cli/src/image-build.ts` | Docker image build with host API registration. |
| `@sumeru/cli` | `packages/cli/src/http-client.ts` | Typed HTTP/SSE client for all host API endpoints. |
| `@sumeru/cli` | `packages/cli/src/pid-file.ts` | PID file management for server start/stop. |

## See Also

- [Host HTTP Service](./host-service.md) — API endpoints the CLI consumes.
- [Docker Image Build](./docker-image.md) — multi-agent image strategy.
