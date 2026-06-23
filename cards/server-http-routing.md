---
id: server-http-routing
title: "Server HTTP Routing"
sources:
  - packages/server/src/handler.ts
  - packages/server/src/types.ts
  - packages/server/src/sse/messages.ts
tags: [architecture, server, http, routing]
created: 2026-06-15
updated: 2026-06-23
---

# Server HTTP Routing

`createHandler(config)` is a hand-written router over Node HTTP primitives. Route dispatch is path-first with explicit matcher functions and no framework middleware layer.

## Top-Level Route Behavior

Current route handling includes:

- `GET /` -> `@sumeru/instance`
- `GET /gateways` -> `@sumeru/gateway-list`
- `GET /gateways/:name` -> `@sumeru/gateway`
- `GET|HEAD /sessions` -> cross-gateway search (`@sumeru/search-result`)
- `GET|HEAD /ocas/:hash` -> raw node `{ type, value }` with cache headers
- `POST /gateways/:name/sessions` -> create session (`@sumeru/session`)
- `GET|HEAD /gateways/:name/sessions` -> list or per-gateway search
- `GET|DELETE /gateways/:name/sessions/:id` -> session detail / logical close
- `GET|POST /gateways/:name/sessions/:id/messages` -> history / SSE send
- export route delegated via `matchSessionExport` + `handleSessionExport`

Unmatched routes return 404 with `error: not_found`, except `/ocas` and `/ocas/` which return 404 with `error: route_not_found`.

## Method Handling and Envelopes

- JSON responses are wrapped with typed envelopes (`@sumeru/*` or `@sumeru/error`).
- Method mismatches return `405 method_not_allowed` and set `Allow`.
- Gateway/session lookup failures consistently use 404 with `gateway_not_found` / `session_not_found`.

## Gateway and Session Collection Semantics

`/gateways/:name/sessions` does:

- query-based search path when `isSearchRequest(queryString)` is true
- otherwise list/create logic

Create path key points:

- parses JSON object body with 1 MiB cap
- extracts optional `config` object
- resolves/validates cwd via `resolveSessionCwd`
- forwards only core session config shape to adapter (`model`, resolved `cwd`)
- adapter create failure maps to `502 adapter_error` or `504 adapter_timeout`
- session-meta write failure maps to `500 ocas_write_failed`

## Messages Endpoint Routing Coupling

`handleMessages(...)` dispatches:

- `GET` -> history endpoint (`@sumeru/message-history`)
- `POST` -> `handleMessageEndpoint(...)`
- others -> `405` with `Allow: GET, POST`

`handleMessageEndpoint` provides SSE flow plus resume behavior and error taxonomy (`invalid_last_event_id`, `no_event_buffer`, `stream_expired`, `session_busy`, `adapter_unavailable`, etc.), which is now part of effective routing semantics for `/messages` POST.

## Gateway Readiness Mapping Note

Gateway list/detail readiness (`ready|unavailable`) is computed with adapter-name lookup (`adapters[cfg.adapter]`). This can differ from startup logging checks that use gateway-name lookup in `startServer`.
