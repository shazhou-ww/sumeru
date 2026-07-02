---
id: manifest-schema
title: "V3 Data Model"
sources:
  - packages/core/src/types.ts
  - packages/host/src/sqlite-store.ts
  - packages/host/src/config.ts
  - packages/host/src/data-store.ts
tags: [sumeru, data-model, sqlite]
created: 2026-06-28
updated: 2026-07-01
---

# V3 Data Model

> V3 replaces the monolithic `manifest.yaml` with a hybrid SQLite + YAML data model. Provider, Model, Persona, and Skill are SQLite entities; Prototype and Image remain YAML-based.

## Overview

The V3 data model separates concerns: configuration entities that require CRUD operations (providers, models, personas, skills) live in SQLite at `data/sumeru.db`. Prototype definitions — which bind persona + model + image into a deployable unit — remain as individual YAML files under `data/prototypes/`. This hybrid allows the CLI and host to share database access via the `@sumeru/host/sqlite` subpath export.

## Entity Relationships

```mermaid
erDiagram
  Provider ||--o{ Model : "has many"
  Model ||--o{ Prototype : "referenced by"
  Persona ||--o{ Prototype : "referenced by"
  Persona }o--o{ Skill : "includes"
  Image ||--o{ Prototype : "referenced by"
```

## SQLite Schema (v3)

**providers** table:
- `name` TEXT PK, `api_type` TEXT, `base_url` TEXT, `api_key` TEXT, timestamps

**models** table:
- `id` TEXT PK, `provider` TEXT FK→providers, `model` TEXT, `context_window` INT, `tool_use` BOOL, `streaming` BOOL, `metadata` JSON, timestamps

**personas** table:
- `name` TEXT PK, `instructions` TEXT, `skills` JSON array, timestamps

**skills** table:
- `name` TEXT PK, `content` TEXT, timestamps

Migrations run automatically (schema version tracked in `PRAGMA user_version`).

## Prototype YAML

Individual files at `data/prototypes/<name>.yaml`:

```yaml
name: sarsapa
persona: default
model: claude-sonnet-4-20250514
image: sarsapa
```

Each prototype references:
- A persona name (resolved from SQLite)
- A model id (resolved from SQLite)
- An image name (resolved from `images.yaml`)
- Optional `defaults: { maxTurns, timeout, resources: { cpu, memory } }`

## Images YAML

`images.yaml` at root dir (or embedded in `host.yaml`):

```yaml
sarsapa:
  description: "Sumeru sarsapa image (sumeru/sarsapa:dev)"
  dockerfile: "packages/sarsapa/Dockerfile"
  builtAt: "2026-07-01T00:00:00.000Z"
  digest: "sha256:..."
```

## host.yaml (Minimal)

```yaml
name: sumeru
maxRunning: 3
workspaceRoot: ~/.sumeru/workspace
envFile: ~/.sumeru/.env
```

The `models` section is deprecated — a warning is emitted if present, directing users to use SQLite entities instead.

## Model Resolution at Session Time

`resolveSessionModel()` in config.ts handles model override:

1. If session provides an inline model object → use directly.
2. If session provides a model id string → look up in SQLite.
3. Otherwise → use prototype's default model id → look up in SQLite.

Resolution joins Provider (for endpoint + apiType) with Model (for model name) to produce a `ModelConfig` used by the adapter init frame.

## Prototype Compose Convention

Each prototype can have a `compose.yaml` at `prototypes/<name>/compose.yaml` that defines the Docker Compose service. The compose file must bind-mount `${SUMERU_PROJECT_PATH}` for adapter cwd access.

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/core` | `packages/core/src/types.ts` | Canonical type definitions for all entities. |
| `@sumeru/host` | `packages/host/src/sqlite-store.ts` | SQLite CRUD implementation (better-sqlite3). |
| `@sumeru/host` | `packages/host/src/config.ts` | Loads host.yaml, prototypes, images, opens SQLite store. |
| `@sumeru/host` | `packages/host/src/data-store.ts` | Prototype YAML loading and hash computation. |

## See Also

- [Architecture Overview](./architecture-overview.md) — how the data model fits the runtime layers.
- [Prototype Versioning](./prototype-versioning.md) — hash/version behavior over prototype changes.
- [CLI Tool](./cli.md) — `setup` command that seeds the data model.
