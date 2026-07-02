---
id: architecture-overview
title: "Architecture Overview"
sources:
  - packages/core/src/types.ts
  - packages/host/src/server.ts
  - packages/host/src/config.ts
  - packages/host/src/sqlite-store.ts
tags: [sumeru, architecture]
created: 2026-06-28
updated: 2026-07-02
---

# Architecture Overview

> Sumeru V3 runs a Host-managed multi-agent runtime where sessions execute adapter processes inside Docker containers through a unified NDJSON contract.

## Overview

Sumeru models runtime concerns in three layers: **Prototype**, **Session**, and **Adapter process**. A prototype is declarative configuration binding a persona, model, adapter, and optional extensions. A session is the live, addressable runtime object that receives messages and emits turn/exit events. Docker images are derived from the adapter name (`sumeru/sarsapa:dev` or `sumeru/adapter-<name>:dev`) and declared in compose files — there is no separate Image entity.

V3 uses a **hybrid data model**: Provider, Model, Persona, and Skill entities live in SQLite (`data/sumeru.db`); Prototypes and Extensions are YAML files (`data/prototypes/*.yaml`, `data/extensions/*.yaml`). The `@sumeru/host/sqlite` subpath export allows the CLI to share database access with the host.

## Layer Model

```mermaid
flowchart TB
  A[Adapter Docker image\ncompose.yaml tag] --> B[Prototype\nYAML: persona + model + adapter + extensions]
  B --> C[Session\nses_* runtime record]
  C --> D[Messages\nPOST /sessions/:id/messages]
  D --> E[Adapter process\nstdin/stdout NDJSON]
  E --> F[Events SSE\nGET /sessions/:id/events]
```

## Data Model (SQLite + YAML Hybrid)

```mermaid
flowchart LR
  subgraph SQLite
    P[Provider] --> M[Model\nid = provider:name]
    PS[Persona] --> SK[Skill]
  end
  subgraph YAML
    PR[Prototype\ndata/prototypes/*.yaml]
    EX[Extension\ndata/extensions/*.yaml]
  end
  PR -->|references| M
  PR -->|references| PS
  PR -->|references| EX
  PR -->|adapter| AD[Docker image tag\nprototypes/name/compose.yaml]
```

- **Provider**: name, apiType (anthropic|openai), baseUrl, apiKey
- **Model**: name (short), provider FK, LLM model string, contextWindow, toolUse, streaming. ID = `provider:name`
- **Persona**: name, instructions, skills[] references
- **Skill**: name, content (text blob)
- **Extension**: name, description, dockerfile instructions
- **Prototype**: name, persona ref, model ref (`provider:name`), adapter, extensions[], optional defaults

## Runtime Responsibilities

- Host HTTP service registers all control/data routes and serializes envelope responses.
- Session manager owns lifecycle, adapter process sessions, concurrency slots, and exit signals.
- Transport abstraction isolates Docker Compose execution backend (`up/down/rm/exec`).
- Adapter core enforces a single unified stdin/stdout NDJSON contract across all agent types.
- SSE buffering adds reconnect/replay behavior for event consumers.
- Session model override allows any session to use a different model than its prototype default.
- Model resolution priority: session override > prototype.model > host.yaml `defaults.model`.

## Message Pipeline

```mermaid
sequenceDiagram
  participant Client as HTTP Client
  participant Host as Host Router/Handlers
  participant SM as Session Manager
  participant T as Docker Transport
  participant A as Adapter CLI
  participant SSE as SSE Events

  Client->>Host: POST /sessions/:id/messages
  Host->>SM: submitMessage()
  SM->>T: exec(containerId, command)
  T->>A: docker exec → adapter NDJSON
  SM->>A: {type:"init"} then {type:"message"}
  A-->>SM: turn/done/suspend/error frames
  SM-->>SSE: append + broadcast events
  Client->>Host: GET /sessions/:id/events
  Host-->>Client: replay + live SSE stream
```

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/core` | `packages/core/src/types.ts` | Defines canonical Provider, Model, Persona, Prototype, Extension, Session, Turn types. |
| `@sumeru/host` | `packages/host/src/server.ts` | Builds HTTP handler, wires all routes via segment-based router. |
| `@sumeru/host` | `packages/host/src/config.ts` | Loads host.yaml + prototypes + extensions, opens SQLite store. |
| `@sumeru/host` | `packages/host/src/sqlite-store.ts` | SQLite CRUD for Provider, Model, Persona, Skill entities. |
| `@sumeru/host` | `packages/host/src/session-manager.ts` | Owns session lifecycle, adapter readiness, frame ingestion, and SSE broadcast. |

## See Also

- [Host HTTP Service](./host-service.md) — route surface and envelope contract.
- [Adapter Unified I/O Contract](./adapter-contract.md) — NDJSON frame protocol.
- [Session Lifecycle](./instance-lifecycle.md) — creation/stop/deletion/state behavior.
- [Data Model](./manifest-schema.md) — SQLite + YAML schema details.
