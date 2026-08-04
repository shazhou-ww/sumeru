---
id: docker-image
title: "Docker Image Build"
sources:
  - docker/sarsapa.Dockerfile
  - docker/hermes.Dockerfile
  - docker/claude-code.Dockerfile
  - docker/codex.Dockerfile
  - packages/cli/src/image-build.ts
tags: [sumeru, docker]
created: 2026-06-28
updated: 2026-07-02
---

# Docker Image Build

> All Dockerfiles are in the `docker/` directory. Use `pnpm run build:images` to build all adapter images into the `images/` directory (gitignored).

## Overview

All Dockerfiles are in the `docker/` directory. Build with `pnpm run build:images` or individually with `docker build -t sumeru/<name>:dev -f docker/<name>.Dockerfile .`.

Docker image tags are **not** stored in a separate registry entity. Tags follow adapter naming: `sumeru/sarsapa:dev` for sarsapa, `sumeru/adapter-<name>:dev` for other adapters. The tag is referenced directly in `prototypes/<name>/compose.yaml`.

## Build Pipeline

```mermaid
flowchart TB
  A[sumeru image build sarsapa --agent sarsapa] --> B[stage .build/]
  B --> C[copy core + adapter-core + agent adapter dist/]
  C --> D[docker build -t sumeru/sarsapa:dev]
  D --> E[compose.yaml references sumeru/sarsapa:dev]
```

Artifacts staged into `.build/packages/`:
- `core/` — `@sumeru/core` dist + package.json
- `adapter-core/` — `@sumeru/adapter-core` dist + package.json
- `<agent>/` — agent-specific adapter dist + package.json

## Image Variants

| Agent | Dockerfile | Base Image | Key Extras |
|-------|-----------|------------|------------|
| sarsapa | `docker/sarsapa.Dockerfile` | `sumeru/base:dev` | Native Sumeru agent |
| hermes | `docker/hermes.Dockerfile` | `sumeru/base:dev` | Hermes CLI (ACP) |
| claude-code | `docker/claude-code.Dockerfile` | `sumeru/base:dev` | Claude CLI |
| codex | `docker/codex.Dockerfile` | `sumeru/base:dev` | Codex CLI |
| cursor-agent | `docker/cursor-agent.Dockerfile` | `sumeru/base:dev` | Cursor Agent CLI |

## Runtime Model

All images use `CMD ["sleep", "infinity"]` — the container stays warm and the host enters it on demand via `docker exec` to run the adapter entrypoint.

- Container lifecycle is decoupled from adapter lifecycle.
- Host keeps container alive across messages (no cold start between turns).
- Adapter process exits at turn boundaries without killing container.

## Sarsapa Dockerfile (reference)

- Base: `node:24-slim` with git, curl, ripgrep, build-essential.
- Copies `core`, `adapter-core`, `sarsapa` dists into `/opt/sumeru/`.
- Creates `node_modules/@sumeru/*` symlinks for runtime resolution.
- Runs as `node` user in `/workspace`.
- Entrypoint: `node /opt/sumeru/adapter-sarsapa/dist/main.js`

## Compose Integration

Each prototype's `prototypes/<name>/compose.yaml` declares the Docker image tag:

```yaml
services:
  agent:
    image: sumeru/sarsapa:dev
    volumes:
      - "${SUMERU_PROJECT_PATH}:${SUMERU_PROJECT_PATH}"
```

`sumeru image build` builds the image locally but does **not** register it anywhere — the compose file is the source of truth for which tag to use.

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| docker/ | `docker/sarsapa.Dockerfile` | Native sarsapa agent runtime image. |
| docker/ | `docker/hermes.Dockerfile` | Hermes ACP agent runtime image. |
| docker/ | `docker/claude-code.Dockerfile` | Claude Code CLI runtime image. |
| docker/ | `docker/codex.Dockerfile` | Codex CLI runtime image. |
| `@sumeru/cli` | `packages/cli/src/image-build.ts` | Build pipeline: staging and docker build. |

## See Also

- [CLI Tool](./cli.md) — `image build` command.
- [Transport Layer](./transport-layer.md) — how host interacts with running containers.
- [Architecture Overview](./architecture-overview.md) — prototype and adapter image in the runtime model.
