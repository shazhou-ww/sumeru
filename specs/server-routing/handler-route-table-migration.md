---
scenario: "createHandler's hand-written matchXxx dispatch chain is replaced by a declarative route table covering all 9 endpoints with byte-identical behavior — the full @sumeru/server test suite passes with zero regression"
feature: server-routing
tags: [http, routing, route-table, refactor, zero-regression, phase-a1, integration]
---

## Given
- `packages/server/src/handler.ts` (today ~940 lines) currently dispatches with a hand-written chain inside `createHandler`: a sequence of `if (path === ...)` literals plus `matchOcasObject`, `matchSessionExport`, `matchSessionMessages`, `matchSessionDetail`, `matchSessionsCollection`, `matchGatewayDetail`, each followed by manual method checks and manual `methodNotAllowed` / `errorEnvelope` calls.
- This is replaced by a declarative route table built with the minimal router (`router-core-matching.md` + `router-method-dispatch.md`): `createAPI().route(method, pattern, handler)`.
- **Scope discipline (issue #108 §不改):** this is a PURE STRUCTURAL refactor. The following are NOT touched: any endpoint's response body / status / headers; SSE send logic in `sse/`messages (turn / heartbeat / done / error / suspend); `buffer.ts` / resume logic; session store; adapters; ocas integration. Only the routing/dispatch layer changes. The per-endpoint handler bodies (`handleSessionsCollection`, `handleSessionDetail`, `handleMessages`, `handleMessageEndpoint`, `handleSessionExport`, `handleOcasObject`, `handleSearchTopLevel`, `handleSearchPerGateway`, history) keep their existing logic; only how they are *reached* changes.
- Commit author `小橘 <xiaoju@shazhou.work>`; commit references `Fixes #108`.

## When
- The server is started (`startServer({ port: 0, ... })`) and the **entire existing** `@sumeru/server` test suite is run against the refactored handler:
  ```bash
  cd ~/repos/sumeru && pnpm --filter @sumeru/server test
  ```
  (On the 2-core NEKO-VM, workspace-wide runs use `--workspace-concurrency=1` to avoid worker kills.)

## Then
- **The complete route table is migrated — all 9 endpoints, cross-checked against real `handler.ts` code (issue #108 §现有路由清单 + "逐条对照，不要漏"):**

  | # | method(s) | pattern | reached handler | success | notable today-behavior to preserve |
  |---|-----------|---------|-----------------|---------|-------------------------------------|
  | 1 | GET | `/` | inline instance envelope | `200 @sumeru/instance` | method-first: `POST /` → 405 `Allow: GET` |
  | 2 | GET | `/gateways` | inline gateway-list | `200 @sumeru/gateway-list` | trailing slash `/gateways/` ≡ `/gateways`; `POST` → 405 `Allow: GET` |
  | 3 | GET | `/gateways/:name` | inline gateway detail | `200 @sumeru/gateway` or `404 gateway_not_found` | method-first (405 before existence); decode-fail → 404 `gateway_not_found`; path-traversal probe is a literal name → 404 |
  | 4 | GET, POST | `/gateways/:name/sessions` | `handleSessionsCollection` | `200 @sumeru/session-list` (GET) / `201 @sumeru/session` (POST) | **resource-first**: unknown gateway → 404 `gateway_not_found` even on disallowed method; `?q=` switches GET/HEAD to search; POST validates body/config/cwd/adapter (400/503/502/504/500 paths); `PUT` on existing → 405 `Allow: GET, POST` |
  | 5 | GET, DELETE | `/gateways/:name/sessions/:id` | `handleSessionDetail` | `200 @sumeru/session` (GET) / `204` (DELETE, idempotent) | **resource-first**: gateway check before session; unknown → `gateway_not_found` / `session_not_found`; `PATCH` → 405 `Allow: GET, DELETE`; trailing slash normalized |
  | 6 | GET, POST | `/gateways/:name/sessions/:id/messages` | `handleMessages` → history (GET) / `handleMessageEndpoint` (POST SSE) | `200 @sumeru/message-history` (GET) / SSE stream (POST) | **resource-first**: gateway/session 404 before method; `PUT` → 405 `Allow: GET, POST`; GET history paginates `offset`/`limit` (400 `invalid_request` on bad ints, cap 1000); SSE body untouched |
  | 7 | POST, HEAD | `/gateways/:name/sessions/:id/export` | `handleSessionExport` | `200` tar.gz stream | **resource-first**: gateway/session 404 before method; HEAD mirrors POST; other methods → 405 `Allow: POST`; trailing slash `/export/` ≡ `/export` |
  | 8 | GET, HEAD | `/ocas/:hash` | `handleOcasObject` | `200 { type, value }` (alias-resolved), `304` on `If-None-Match`, `400 invalid_hash`, `404 ocas_not_found` | method-first (handler gates `GET`/`HEAD`, else 405 `Allow: GET`); `ETag`/`Cache-Control: immutable`; hash regex `^[0-9A-HJKMNP-TV-Z]{13}$` |
  | 9 | GET, HEAD | `/sessions` | `handleSearchTopLevel` | `200 @sumeru/search-result` | method-first: non-GET/HEAD → 405 `Allow: GET`; trailing slash `/sessions/` ≡ `/sessions`; `?q=` required (else 400 `invalid_request`); HEAD = GET headers, empty body |

- **`/ocas` non-endpoint paths keep their exact 404 codes:** `/ocas/` and `/ocas` → `404` (the `route_not_found` special-case for `/ocas` family is preserved per `router-method-dispatch.md`); `/ocas/<hash>/extra` → `404`. Do NOT route `/ocas` to a listing handler — there is none.
- **Generic fallback unchanged:** any path matching no pattern → `404 @sumeru/error` `value.error: "not_found"`, message `No route for <method> <path>`. (NOT `route_not_found` — see `router-method-dispatch.md` source-of-truth note; `server.test.ts` and `gateways.test.ts` assert `not_found`.)
- **Ordering/overlap correctness:** because the old chain matched **more-specific routes first** (export & messages before session-detail before sessions-collection before gateway-detail), the new table must not let a shorter pattern shadow a longer one. The segment-count keying from `router-core-matching.md` guarantees `/gateways/:n/sessions/:i/messages` (6 seg), `/export` (6 seg, distinct literal tail), `/gateways/:n/sessions/:i` (5 seg), `/gateways/:n/sessions` (4 seg), and `/gateways/:n` (3 seg) are all distinct — no path that worked before changes which handler it reaches. In particular `…/sessions/:id/messages` and `…/sessions/:id/export` differ only by their static tail literal, so they never cross-match.
- **Envelope helpers untouched:** `methodNotAllowed`, `errorEnvelope`, `writeJson`, `writeNoContent`, and all `*Envelope` builders keep their current signatures and output. The refactor reuses them; it does not re-implement response writing.
- **No web framework, no new package:** no express/fastify/koa added to `package.json`; no `@ocas/api-kit` package created; the router code lives inside `@sumeru/server` only (issue #108 §设计约束②④). The handler returned by `createHandler` keeps the exact `(req: IncomingMessage, res: ServerResponse) => void` signature so `startServer` wiring is unchanged.

## Verification (acceptance = existing tests zero regression)
- **Step 1 — full server suite green:** `pnpm --filter @sumeru/server test` passes entirely. The suites that gate this refactor: `server.test.ts`, `gateways.test.ts`, `sessions.test.ts`, `messages.test.ts`, `messages-history.test.ts`, `ocas-object-endpoint.test.ts`, `search-endpoint.test.ts`, `export-endpoint.test.ts`, `session-store.test.ts`, `envelope.test.ts`. Zero regression — issue #108: "纯重构，行为逐字节不变，任何一条挂了都说明重构改变了行为".
- **Step 2 — typecheck + lint:** `pnpm run typecheck && pnpm run check` exit 0. Router types complete (no `any`, no unchecked index access), Biome-clean, CLAUDE.md conventions (`type` over `interface`, `function` over `class`, named exports, `.js` imports, `T | null` not optional props).
- **Step 3 — smoke (behavior unchanged):** with the server up —
  - `curl -s localhost:<port>/ | jq .type` → `"@sumeru/instance"`
  - `curl -s localhost:<port>/gateways | jq .type` → `"@sumeru/gateway-list"`
  - `curl -s -X DELETE localhost:<port>/gateways | jq -r .value.error` → `method_not_allowed` (405)
  - `curl -s localhost:<port>/nonexistent | jq -r .value.error` → `not_found` (404) — **note: `not_found`, matching the tests, not the issue's `route_not_found` wording.**
- **Step 4 — router unit tests added** per `router-core-matching.md` and `router-method-dispatch.md` (static match, `:param` extract, 405, 404, trailing slash).
- **Net effect:** the hand-written `matchGatewayDetail` / `matchSessionsCollection` / `matchSessionDetail` / `matchSessionMessages` / `matchOcasObject` boilerplate and the manual method/405/404 scaffolding are gone, replaced by a declarative table; `matchSessionExport` (currently exported from `export/handler.ts`) is likewise expressed as a route. Line count drops materially while the observable HTTP contract is byte-identical.
</content>
