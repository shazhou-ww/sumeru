---
id: server-http-routing
title: "HTTP Server Routing"
sources:
  - packages/server/src/handler.ts
  - packages/server/src/envelope.ts
  - packages/server/src/types.ts
tags: [architecture, server, http, routing]
created: 2026-06-15
updated: 2026-06-15
---

# HTTP Server Routing

`@sumeru/server` exposes a single Node.js HTTP request handler built by `createHandler(config: ServerConfig)`. All routing is hand-written path matching — no framework, no middleware chain.

## Route Table

| Method | Path | Status | Envelope Type | Phase |
|--------|------|--------|---------------|-------|
| GET | `/` | 200 | `@sumeru/instance` | 1 |
| GET | `/gateways` | 200 | `@sumeru/gateway-list` | 1 |
| GET | `/gateways/:name` | 200 | `@sumeru/gateway` | 1 |
| POST | `/gateways/:name/sessions` | 201 | `@sumeru/session` | 2 |
| GET | `/gateways/:name/sessions` | 200 | `@sumeru/session-list` | 2 |
| GET | `/gateways/:name/sessions?q=` | 200 | `@sumeru/search-result` | 5 |
| GET | `/gateways/:name/sessions/:id` | 200 | `@sumeru/session` | 2 |
| DELETE | `/gateways/:name/sessions/:id` | 204 | (no body) | 2 |
| POST | `/gateways/:name/sessions/:id/messages` | SSE | turn/heartbeat/done/error events | 3 |
| GET | `/gateways/:name/sessions/:id/messages` | 200 | `@sumeru/message-history` | 3 |
| POST | `/gateways/:name/sessions/:id/export` | 200 | tar.gz stream | 5 |
| GET | `/ocas/:hash` | 200 | `{ type, value }` raw node | 4 |
| GET | `/sessions?q=` | 200 | `@sumeru/search-result` | 5 |

All non-success responses use the `@sumeru/error` envelope. Method mismatches return 405 with a populated `Allow` header.

## Envelope Pattern

Every JSON response body follows the ocas envelope shape:

```typescript
type Envelope<T> = {
  type: string;   // e.g. "@sumeru/instance", "@sumeru/error"
  value: T;       // payload differs per type
};
```

Envelope constructors live in `envelope.ts`:

| Function | Type String | Used By |
|----------|-------------|---------|
| `instanceEnvelope` | `@sumeru/instance` | `GET /` |
| `gatewayListEnvelope` | `@sumeru/gateway-list` | `GET /gateways` |
| `gatewayEnvelope` | `@sumeru/gateway` | `GET /gateways/:name` |
| `sessionEnvelope` | `@sumeru/session` | POST create / GET detail |
| `sessionListEnvelope` | `@sumeru/session-list` | `GET /gateways/:name/sessions` |
| `searchResultEnvelope` | `@sumeru/search-result` | search endpoints |
| `errorEnvelope` | `@sumeru/error` | all error responses |

## Path Matching

Routes are matched by a series of pure functions, each returning `null` on no-match:

- `matchGatewayDetail(path)` — `/gateways/<name>` (single segment, no sub-paths)
- `matchSessionsCollection(path)` — `/gateways/<name>/sessions`
- `matchSessionDetail(path)` — `/gateways/<name>/sessions/<id>`
- `matchSessionMessages(path)` — `/gateways/<name>/sessions/<id>/messages`
- `matchSessionExport(path)` — `/gateways/<name>/sessions/<id>/export`
- `matchOcasObject(path)` — `/ocas/<hash>`

Key behaviors:
- Query strings are stripped before matching (`stripQueryString`)
- Trailing slashes are tolerated (stripped internally)
- Path segments remain URL-encoded until `decodePathSegment` is called per-segment (returns `null` on malformed encoding → 404)
- Ocas hashes are validated against `HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/` (Crockford Base32, 13 chars)

## Request Dispatch Flow

```
req.url → stripQueryString → try matchers top-to-bottom:
  /          → instance info
  /gateways  → gateway list
  /ocas/:h   → ocas node lookup (ETag/If-None-Match → 304)
  /sessions  → top-level search
  export     → session export handler
  messages   → SSE (POST) or history (GET)
  detail     → session GET/DELETE
  collection → session list (GET) or create (POST, with ?q= → search)
  gateway    → single gateway info
  fallback   → 404
```

The handler is a closure over:
- `sessions: SessionStore` — in-memory session state
- `bufferStore: SseBufferStore` — per-send ring buffers for SSE resume

## JSON Body Parsing

POST endpoints use `readJsonBody(req)` — a streaming parser with:
- **1 MiB cap** on request body size
- Empty body treated as `{}`
- Validates the result is a non-null, non-array object
- Returns a discriminated union: `{ ok: true, value }` or `{ ok: false, error, message }`

## Session Creation Flow (POST /gateways/:name/sessions)

1. Validate gateway exists and adapter is registered
2. Parse request body, extract `config` field
3. Resolve `config.cwd` against `workspaceRoot` (security-confined)
4. Call `adapter.createSession(forwardedConfig)` — timeout → 504, other failure → 502
5. Register session in store (writes `@sumeru/session-meta` to ocas)
6. Return 201 with `@sumeru/session` envelope

## Message History (GET .../messages)

Paginated turn retrieval from ocas:
- `?offset=N` — skip first N turns (default 0)
- `?limit=N` — max turns to return (capped at 1000)
- Each turn is fetched from CAS by hash, with the hash injected into the response as `TurnValue`

## Ocas Object Endpoint (GET /ocas/:hash)

Content-addressed node retrieval with aggressive caching:
- `Cache-Control: public, max-age=31536000, immutable`
- `ETag` set to the hash itself
- `If-None-Match` support → 304 Not Modified
- Schema hash is resolved to a human-readable type name via `ocas.schemaAliases`

## Error Handling Conventions

- Unknown gateway → `gateway_not_found` (404)
- Unknown session → `session_not_found` (404)
- Invalid method → `method_not_allowed` (405) with `Allow` header
- Adapter failure → `adapter_error` (502) or `adapter_timeout` (504)
- Bad request body → `invalid_request` / `invalid_json` (400)
- Internal failure → `ocas_write_failed` (500)

Error messages are truncated to 500 characters to prevent response bloat.
