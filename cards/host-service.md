---
id: host-service
title: "Host HTTP Service"
sources:
  - packages/host/src/server.ts
  - packages/host/src/router.ts
  - packages/host/src/handlers/root.ts
  - packages/host/src/handlers/prototypes.ts
  - packages/host/src/handlers/instances.ts
  - packages/host/src/handlers/inbox.ts
  - packages/host/src/handlers/outbox.ts
  - packages/host/src/handlers/history.ts
  - packages/host/src/handlers/search.ts
  - packages/host/src/handlers/export.ts
  - packages/host/src/envelope.ts
tags: [sumeru, host]
created: 2026-06-28
updated: 2026-06-28
---

# Host HTTP Service

> The host provides a minimal HTTP API for discovery, lifecycle control, message ingress, and event/history egress.

## Overview

`createHostHandler()` composes a route table over a lightweight segment-based router. Routes are method-scoped, support `:param` placeholders, normalize trailing slashes, and return either match, method-not-allowed (with `Allow` header), or route-not-found.

All JSON responses use typed envelopes (`{ type, value }`), with typed channel names under the `@sumeru/*` namespace. Error responses are also enveloped (`@sumeru/error`) and include both machine code (`error`) and human message.

## Route Surface

```mermaid
flowchart TB
  A[GET /] --> H[@sumeru/host]
  B[GET /prototypes] --> P1[@sumeru/prototype-list]
  C[GET /prototypes/:name] --> P2[@sumeru/prototype]
  D[GET /instances] --> I1[@sumeru/instance-list]
  E[POST /instances] --> I2[@sumeru/instance]
  F[DELETE /instances/:id] --> N1[204]
  G[GET /instances/:id/status] --> I3[@sumeru/instance-status]
  J[POST /instances/:id/reset] --> N2[204]
  K[POST /instances/:id/inbox] --> M1[@sumeru/inbox-accepted]
  L[GET /instances/:id/outbox] --> S1[SSE stream]
  M[GET /instances/:id/history] --> H1[@sumeru/history]
  N[POST /instances/:id/export] --> X1[gzip JSONL]
  O[GET /search?q=...] --> S2[@sumeru/search]
```

## Envelope Types

- `@sumeru/host`: host identity, version, master id, prototype ids, instance ids.
- `@sumeru/prototype-list`: `{ name, adapter }[]` summary list.
- `@sumeru/prototype`: single prototype with manifest payload.
- `@sumeru/instance-list` and `@sumeru/instance`: instance metadata.
- `@sumeru/instance-status`: runtime status + current container handle.
- `@sumeru/inbox-accepted`: accepted inbox ack with generated `messageId`.
- `@sumeru/history`: paginated turn history for one instance.
- `@sumeru/search`: query and matching hits.
- `@sumeru/error`: normalized error envelope.

## Request/Response Patterns

- JSON body parsing is centralized (`readJsonBody`) and rejects invalid JSON with `400`.
- `POST /instances` requires non-empty `prototype`; optional `projects[]`.
- `POST /instances/:id/inbox` requires non-empty `content`; optional `project`.
- `GET /instances/:id/history` accepts `limit` and `offset` (non-negative ints; limit max 1000).
- `GET /search` requires `q`; optional `instance` filter must be non-empty if provided.
- `POST /instances/:id/export` streams `application/gzip` with attachment filename `<id>.jsonl.gz`.

## Router Behavior

- `HEAD` automatically matches `GET` routes.
- Method mismatch returns `405` with computed `Allow` header.
- Unknown path returns `404 route_not_found`.
- Query parsing is delegated to handlers using raw query string from router.

## Code Pointers

| Package | File | What it does |
|---------|------|--------------|
| `@sumeru/host` | `packages/host/src/server.ts` | Registers all public host routes and creates the HTTP server. |
| `@sumeru/host` | `packages/host/src/router.ts` | Segment matcher with param extraction and method discrimination. |
| `@sumeru/host` | `packages/host/src/handlers/inbox.ts` | Validates inbox body, generates message id, dispatches to manager. |
| `@sumeru/host` | `packages/host/src/handlers/outbox.ts` | SSE replay/live stream handler with reconnect semantics. |
| `@sumeru/host` | `packages/host/src/envelope.ts` | Defines all response envelope constructors (`@sumeru/*`). |

## See Also

- [SSE Reliability](./sse-reliability.md) — replay buffer, heartbeat, and reconnect guarantees.
- [Instance Lifecycle](./instance-lifecycle.md) — semantics behind create/delete/reset/status.
- [OCAS Recording & History](./ocas-recording.md) — history/search/export storage path.
