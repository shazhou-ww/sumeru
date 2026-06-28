---
scenario: "Router dispatches by method and auto-generates 405 (path matched, method wrong) vs 404 (no path matched), reusing the existing methodNotAllowed/error envelope helpers"
feature: server-routing
tags: [http, routing, method-dispatch, 405, 404, allow-header, refactor, phase-a1, unit]
---

## Given
- The minimal router from `router-core-matching.md` is in place.
- `route(method, pattern, handler)` registers method + path as a **single first-class key** (issue #108 §设计约束③: `route("POST", path)` is first-class). Multiple methods on the same path are independent registrations, e.g. both `GET /gateways/:name/sessions` and `POST /gateways/:name/sessions`.
- The existing `methodNotAllowed(res, method, path, allow)` helper (today in `handler.ts`) and the `errorEnvelope(code, message)` helper (from `envelope.js`) are **reused unchanged** — issue #108 §设计约束③ says "复用现有 methodNotAllowed". The refactor MUST NOT invent a new 405/404 body shape.
- For a path, the router knows the set of methods registered on the matching pattern; the `Allow` header is the comma-space-joined list of those methods in **declaration order** (matching today's literal strings: `"GET"`, `"GET, POST"`, `"GET, DELETE"`, `"GET, POST"` for messages, `"POST"` for export, `"GET"` for ocas).

## When
- The router is mounted as the instance request handler (still `(req, res) => void`, returned by `createHandler`, issue #108 §设计约束②).
- A series of requests arrive whose path matches a registered pattern but whose method does or does not match, plus requests whose path matches nothing.

## Then
- **Method match → dispatch** — when both method and path match, the corresponding handler runs and produces today's exact response. E.g. `GET /` → `200 @sumeru/instance`; `GET /gateways` → `200 @sumeru/gateway-list`; `POST /gateways/:name/sessions/:id/messages` → SSE.
- **Path matches, method does not → auto 405** — for routes that are **method-first** (see precedence rule below), a path whose pattern is registered but not for this method yields `405 Method Not Allowed` via `methodNotAllowed(...)`:
  - `Allow` header set to the registered methods for that pattern.
  - Body is the `@sumeru/error` envelope with `value.error: "method_not_allowed"` and message `Method <M> not allowed on <path>`.
  - Verified today by: `server.test.ts` (`POST /` → 405, `Allow: GET`), `gateways.test.ts` (`POST /gateways` → 405 `Allow: GET`; `POST /gateways/hermes` → 405 `Allow: GET`), `ocas-object-endpoint.test.ts` (`POST /ocas/<hash>` → 405 `Allow: GET`), `search-endpoint.test.ts` (`POST /sessions?q=login` → 405 `Allow: GET`).
- **No path match → auto 404 `not_found`** — when no registered pattern matches the path at all, the router emits the **generic fallback** `404` with `@sumeru/error` `value.error: "not_found"` and message `No route for <method> <path>`. This is the catch-all at the very bottom of today's `createHandler` (`errorEnvelope("not_found", ...)`).
  - Verified today by: `server.test.ts` ("returns 404 envelope on unknown GET path" → `value.error: "not_found"`), `gateways.test.ts` ("uses gateway_not_found, distinct from generic not_found" → the unknown path returns `not_found`).
  - ⚠️ **Source-of-truth note:** issue #108's smoke-test text says `GET /nonexistent` → `route_not_found`. The **actual existing tests assert `not_found`** (see above). Zero-regression means the tests win: the generic fallback code stays **`not_found`**. `route_not_found` is NOT the generic fallback — it is an `/ocas`-family special case (next bullet).
- **`/ocas` family special 404s (`route_not_found`) — preserve verbatim** — these are quirks of the current code that MUST survive the refactor byte-for-byte:
  - `GET /ocas/` (empty hash, trailing slash) → `404` with `value.error: "route_not_found"` (asserted by `ocas-object-endpoint.test.ts:160`).
  - `GET /ocas` (no trailing slash, no listing endpoint) → `404`; the test only asserts status `404` (`ocas-object-endpoint.test.ts:167`), and today's code path returns the generic `not_found` here. Keep returning `404`; do not change the code in a way that breaks the status.
  - `GET /ocas/<hash>/extra` (too many segments) → `404` (status-only assertion, `ocas-object-endpoint.test.ts:172`).
  - Implementation note: today `matchOcasObject` returns `null` for `/ocas`, `/ocas/`, and `/ocas/<hash>/extra`; the special-casing that turns `/ocas` & `/ocas/` into `route_not_found` is an explicit `if (path === "/ocas" || path === "/ocas/")` branch **before** the generic fallback. The refactor may keep this as a tiny explicit guard (it is sumeru's one true edge case) — do not try to make the generic router emit `route_not_found`, or the `/nonexistent → not_found` tests will regress.
- **Non-uniform method-vs-resource precedence — the #1 zero-behavior-change trap. Preserve per-route:**
  - **Method-first routes (405 wins over resource checks):** `/`, `/gateways`, `/gateways/:name`, `/ocas/:hash`, `/sessions` (top-level search). For these, a wrong method returns `405` even though the resource might not exist. E.g. `POST /gateways/does-not-exist` is `405` (method checked before gateway existence) — matches `matchGatewayDetail` branch which calls `methodNotAllowed` before any lookup.
  - **Resource-first routes (404 wins over method):** the `/gateways/:name/sessions…` family. For session-collection, session-detail, messages, and export, an **unknown gateway or session returns its 404 (`gateway_not_found` / `session_not_found`) even when the method is also disallowed**. This is intentional in today's code (`handler.ts` comment: "404 for unknown gateway is reported even on disallowed methods so callers see the most-specific failure"). Only when the gateway/session DO exist and the method is wrong do these routes return `405`.
    - Verified today by: `sessions.test.ts` (unknown gateway on `PUT /gateways/does-not-exist/sessions`? — collection returns `gateway_not_found` 404; `PUT` on an existing collection → `405 Allow: GET, POST`; `PATCH` on existing session → `405 Allow: GET, DELETE`), `messages.test.ts` (`PUT /messages` on existing session → `405 Allow: GET, POST`; unknown gateway/session → 404).
  - **Implication for the router design:** the auto-405 cannot be a blanket "pattern matched but method unregistered → 405" rule for the sessions family, because the resource check must run first. The handler for these routes is registered for the union of methods (so the router dispatches into it), and the handler itself performs gateway→session existence checks before its own method gate — exactly as today. The router's auto-405 fully owns only the method-first routes. The spec for this split MUST be honored; collapsing both into one uniform rule changes behavior and fails the suite.
- **HEAD handling preserved** — routes that today accept `HEAD` continue to:
  - `/sessions` and `/gateways/:name/sessions` treat `HEAD` like `GET` (search/list), `200` with empty body (`search-endpoint.test.ts` "HEAD /sessions?q=login same headers as GET, empty body").
  - `/ocas/:hash` accepts `GET` and `HEAD` (the handler's own `method !== "GET" && method !== "HEAD"` gate), `Allow: GET` on 405.
  - `/gateways/:name/sessions/:id/export` accepts `POST` and `HEAD`, `Allow: POST` on 405 (`export-endpoint.test.ts` HEAD case).
  These HEAD acceptances live inside the route handlers today; the refactor must not drop them. Whether HEAD is modeled as an explicit `route("HEAD", …)` or handled inside the action is the implementer's call, as long as the observable status/headers/body are unchanged.

## Verification
- New unit tests (`packages/server/tests/router.test.ts`) cover: method match → dispatch, path-match-method-mismatch → 405 with correct `Allow`, no-match → 404 `not_found`. (Issue #108 Step 4: "method 不符→405、全不匹配→404".)
- The full `pnpm --filter @sumeru/server test` suite passes with **zero regression** — every 405/404 assertion enumerated above (across server / gateways / sessions / messages / ocas-object / search / export tests) stays green. Any single failure means the refactor changed behavior (issue #108 §验证: "任何一条挂了都说明重构改变了行为").
- `pnpm run typecheck && pnpm run check` exit 0.
</content>
