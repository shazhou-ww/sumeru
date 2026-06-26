---
id: server-http-routing
title: "Server HTTP Routing"
sources:
  - packages/server/src/api-kit/router.ts
  - packages/server/src/handler.ts
  - packages/server/src/types.ts
  - packages/server/src/sse/messages.ts
tags: [architecture, server, http, routing]
created: 2026-06-15
updated: 2026-06-26
---

# Server HTTP Routing

`createHandler(config)` builds a declarative router via `createAPI()` from `packages/server/src/api-kit/router.ts`. Routes are registered with `api.route(method, pattern, handler)` and dispatched through `api.handle(req, res)`.

## Router API

```typescript
const api = createAPI({
  methodNotAllowed: (res, method, path, allow) => { ... },
  notFound: (res, method, path) => { ... },
});

api.route("GET", "/gateways/:name", handler);
api.route("*", "/gateways/:name/sessions/:id/messages", handler);

return api.handle;  // Node HTTP request handler
```

### Pattern Matching

- Patterns use static segments and `:param` placeholders (e.g. `/gateways/:name/sessions/:id`).
- `matchSegments` compares request path segments against the pattern, extracting named params.
- Routes are indexed by segment count for O(1) candidate lookup.
- Trailing slashes are normalized (except root `/`).

### Dispatch

`api.handle` parses method + path (+ query string), calls `api.match(method, path)`, then:

- **match** → invoke handler with `(req, res, params, path, queryString)`
- **method_not_allowed** → 405 with populated `Allow` header
- **not_found** → 404 with `error: not_found`

Special cases handled inside `createAPI`:

- `HEAD` requests match `GET` routes automatically.
- Method `"*"` on a route accepts any HTTP method (handler performs its own method gating).

## Registered Routes

Current route handling includes:

- `GET /` → `@sumeru/instance`
- `GET /gateways` → `@sumeru/gateway-list`
- `GET /gateways/:name` → `@sumeru/gateway`
- `GET|HEAD /sessions` → cross-gateway search (`@sumeru/search-result`)
- `GET|HEAD /ocas/:hash` → raw node `{ type, value }` with cache headers
- `POST /gateways/:name/sessions` → create session (`@sumeru/session`)
- `GET|HEAD /gateways/:name/sessions` → list or per-gateway search
- `GET|DELETE /gateways/:name/sessions/:id` → session detail / logical close
- `GET|POST /gateways/:name/sessions/:id/messages` → history / SSE send
- `POST|HEAD /gateways/:name/sessions/:id/export` → session export (`tar.gz`)

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

- `GET` → history endpoint (`@sumeru/message-history`)
- `POST` → `handleMessageEndpoint(...)`
- others → `405` with `Allow: GET, POST`

`handleMessageEndpoint` provides SSE flow plus resume behavior and error taxonomy (`invalid_last_event_id`, `no_event_buffer`, `stream_expired`, `session_busy`, `adapter_unavailable`, etc.), which is now part of effective routing semantics for `/messages` POST.

## Gateway Readiness Mapping Note

Gateway list/detail readiness (`ready|unavailable`) is computed with adapter-name lookup (`adapters[cfg.adapter]`). This can differ from startup logging checks that use gateway-name lookup in `startServer`.
