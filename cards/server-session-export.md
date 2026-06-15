---
id: server-session-export
title: "Session Export"
sources:
  - packages/server/src/export/bundle.ts
  - packages/server/src/export/handler.ts
  - packages/server/src/export/index.ts
tags: [architecture, server, export, ocas]
created: 2026-06-15
updated: 2026-06-15
---

# Session Export

The `packages/server/src/export/` module implements on-demand session export as a `tar.gz` bundle. The exported archive is self-contained and can be re-imported into another ocas store via `importBundle` to reproduce the recording bit-for-bit.

## HTTP Endpoint

```
POST /gateways/:name/sessions/:id/export  → 200 application/gzip
HEAD /gateways/:name/sessions/:id/export  → 200 (headers only, no body)
```

Allowed methods: POST, HEAD. Other methods return 405 with `Allow: POST`.

### Response Headers

| Header | Value |
|--------|-------|
| `Content-Type` | `application/gzip` |
| `Content-Disposition` | `attachment; filename="<sessionId>.tar.gz"` |
| `Cache-Control` | `no-store` |
| `Content-Length` | byte size of gzipped bundle |
| `X-Sumeru-Export-Nodes` | total CAS nodes included |
| `X-Sumeru-Export-Session` | session ID |

## Export Flow

1. **Validate** — gateway exists, session exists (404 on miss)
2. **Drain request body** — read and discard any POST body (keep-alive compatibility)
3. **Build bundle** — `buildSessionExport(session, ocas)`
4. **Stream response** — `streamExportResponse(res, ...)`
5. **Cleanup** — remove temp directory after response finishes

## Bundle Building (`buildSessionExport`)

```typescript
async function buildSessionExport(session, ocas): Promise<{
  tarGzPath: string;
  tempDir: string;
  nodes: number;
}>
```

Steps:
1. Create a temp directory (`mkdtempSync` in OS temp)
2. Collect root hashes: `[session.metaHash, ...session.turnHashes]`
3. Call `exportBundle(ocas.store, roots, tarPath)` from `@ocas/core` — writes a `.tar` file containing all reachable CAS nodes from the roots (session-meta + all turns + their schema chain)
4. gzip the tar file (`gzipSync` at level 6)
5. Return the path + node count

The caller owns cleanup of the temp directory.

## Response Streaming (`streamExportResponse`)

For POST requests:
- Creates a `ReadStream` on the `.tar.gz` file
- Pipes it directly to the HTTP response
- Registers cleanup on both `finish` and `close` events

For HEAD requests:
- Sets all headers (including `Content-Length`)
- Ends response immediately without body
- Cleans up synchronously

## Bundle Contents

The exported tar includes the full CAS graph reachable from the session's root hashes:

```
roots = [metaHash, turnHash_0, turnHash_1, ..., turnHash_N]
```

`@ocas/core.exportBundle` walks these roots and includes all referenced nodes — which means the schema nodes (`@sumeru/turn`, `@sumeru/session-meta`, `@ocas/schema`) are also included, making the bundle fully self-contained.

## Safety Controls

- **Soft node cap**: sessions exceeding 100,000 nodes log a warning (`[sumeru] large export: ...`)
- **Temp cleanup**: always runs via `res.once("close")` + explicit `await cleanup()` after streaming — ensures no leaked temp files even on client disconnect
- **Body drain**: incoming POST body is fully consumed before export starts to prevent connection stalls
- **Error handling**: build failures return 500 `export_failed` with truncated cause (500 char max)

## Path Matcher

`matchSessionExport(path)` matches `/gateways/<name>/sessions/<id>/export` (with optional trailing slash). Returns `{ gatewayRaw, idRaw }` or `null`.

## Module Exports

`export/index.ts` re-exports:
- `buildSessionExport`, `streamExportResponse` (bundle building)
- `handleSessionExport`, `matchSessionExport` (HTTP handler + path matcher)
