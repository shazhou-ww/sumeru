---
id: master-agent
title: "Master Agent"
sources:
  - packages/host/src/instance-manager.ts
  - packages/host/src/local-transport.ts
  - packages/host/src/config.ts
  - packages/host/src/id.ts
tags: [sumeru, master]
created: 2026-06-28
updated: 2026-06-28
---

# Master Agent

> The master agent is a reserved `inst_0` runtime that is booted implicitly and executed via local transport.

## Overview

Master is not a prototype-backed worker. It is pre-created in instance manager with `prototype: null`, booted during host startup, and routed to a local process backend (`LOCAL_MASTER_HANDLE`) instead of Docker containers.

Master init config and adapter command come from `host.yaml` `master.config`, with fallbacks in host config loader.

## Reservation Model

```mermaid
flowchart TB
  A[Host start] --> B[createInstanceManager()]
  B --> C[seed inst_0]
  C --> D[bootMaster()]
  D --> E[routing transport -> local]
  E --> F[master adapter process]
```

## Runtime Characteristics

- fixed id: `inst_0`.
- fixed project name derived from id (`inst-0`).
- container handle for local runtime is `master`.
- master is included in `/instances` list like workers.
- lifecycle guards prevent delete/reset through API.

## Adapter Command Resolution

`resolveMasterAdapterCommand(hostConfig)` precedence:

1. `master.config.command` as string array.
2. `master.config.binary` as `node <binary>`.
3. fallback `node <root>/packages/adapter-hermes/dist/main.js`.

This command is used only for master adapter exec path.

## Lazy Re-init with masterHash

Master uses `masterHash` (SHA-256 over `host.yaml` master section) as its `initVersion` target. On next inbox after hash drift, manager invalidates master adapter session and re-sends fresh init config from `buildMasterInitConfig()`.

## API Guardrails

- delete master returns `cannot_delete_master` (HTTP 403).
- reset master returns `cannot_reset_master` (HTTP 400).
- master boot is host-controlled (`bootMaster()`), not API-created.

## Master Init Payload

`buildMasterInitConfig()` derives payload from `hostConfig.config.master.config`:

- `instructions`: explicit value or fallback `"You are the master agent."`.
- `skills`: array of `{ name, content }` objects parsed from config.
- `model`: validated model object or fallback placeholder anthropic model.

This payload is sent through the same adapter-core `init` frame used by worker adapters.

## Operational Considerations

- Master runs on bare metal command execution context, so environment and filesystem access differ from containerized workers.
- Master command invalidation is lazy and tied to inbox traffic; config edits do not force immediate process restart.
- If master command is misconfigured, failure appears on inbox path as adapter unavailability or adapter error events.

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/host` | `packages/host/src/instance-manager.ts` | Seeds `inst_0`, boots master, enforces lifecycle guards, and handles master re-init. |
| `@sumeru/host` | `packages/host/src/local-transport.ts` | Defines local master handle and routes master execution to local transport. |
| `@sumeru/host` | `packages/host/src/config.ts` | Builds master init config and resolves master adapter command. |
| `@sumeru/host` | `packages/host/src/id.ts` | Exposes `MASTER_INSTANCE_ID` and project-name mapping helpers. |

## See Also

- [Instance Lifecycle](./instance-lifecycle.md) — shared lifecycle and state behavior.
- [Transport Layer](./transport-layer.md) — local-vs-docker routing logic.
