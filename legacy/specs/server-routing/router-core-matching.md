---
scenario: "Minimal declarative router matches static segments and extracts :param placeholders by split('/') comparison — no regex, no wildcards, no priority resolution"
feature: server-routing
tags: [http, routing, router, param, match, refactor, phase-a1, unit]
---

## Given
- A new minimal router lives inside `@sumeru/server` (e.g. `packages/server/src/api-kit/router.ts`, exact location is the implementer's call — issue #108 §范围 allows inline or sub-module). It is NOT a separate published package (`@ocas/api-kit` is deferred to Phase B per RFC #107 作者倾向②).
- The router is constructed via a factory, e.g. `const api = createAPI()`, and routes are declared with `api.route(method, pattern, handler)` where:
  - `method` is an uppercase HTTP method string (`"GET"`, `"POST"`, `"DELETE"`, …).
  - `pattern` is a path template made only of **static segments** and **`:param` placeholders**, e.g. `"/gateways/:name/sessions/:id/messages"`.
  - `handler` keeps the node-native signature — it receives node's `IncomingMessage` / `ServerResponse` plus the extracted params, and returns `void` (issue #108 §设计约束②: do not bind a web framework, do not `listen()`, handler stays `(req, res) => void`-shaped).
- The router exposes a single matcher used by the request entrypoint, conceptually `match(method, path) → { handler, params } | null | methodMismatch`.
- The core matcher is intentionally tiny (~50 lines, issue #108 §设计约束①). It supports **only** what sumeru's real route table uses; everything beyond "split into segments + compare" is YAGNI-removed.

## When
- The router has these patterns registered (a representative subset of the real table):
  - `GET  /`
  - `GET  /gateways`
  - `GET  /gateways/:name`
  - `GET  /gateways/:name/sessions/:id`
  - `POST /gateways/:name/sessions/:id/messages`
  - `GET  /ocas/:hash`
- The matcher is invoked for a series of paths (the query string has already been stripped by the caller before matching — see `## Then` on query handling).

## Then
- **Static-only match** — `match("GET", "/")` and `match("GET", "/gateways")` resolve to their registered handlers with an **empty params object** `{}`. A literal path equals its pattern when every segment is a static segment and all segments are equal.
- **Single `:param` extraction** — `match("GET", "/gateways/hermes")` resolves to the `/gateways/:name` handler with `params = { name: "hermes" }`. The placeholder segment captures the raw (still URL-encoded) text exactly as it appears in the path; **the router does NOT `decodeURIComponent`** — decoding stays the handler's responsibility, preserving today's behavior where each handler decodes and maps decode failure to its own 404 code (`gateway_not_found` / `session_not_found`).
- **Multi-`:param` extraction** — `match("GET", "/gateways/hermes/sessions/ses_01J")` resolves to `/gateways/:name/sessions/:id` with `params = { name: "hermes", id: "ses_01J" }`. Each placeholder is keyed by its name in declaration order; positional capture is by segment index.
- **Segment-count keying disambiguates overlapping prefixes** — `/gateways/:name/sessions/:id` (5 segments after `split("/")` → `["", "gateways", ":name", "sessions", ":id"]`) and `/gateways/:name/sessions/:id/messages` (6 segments) never collide: a candidate only matches a pattern of **identical segment count**. So `GET /gateways/g/sessions/s/messages` matches the messages route, never the session-detail route. This reproduces the old behavior where `matchSessionMessages` (4-part) and `matchSessionDetail` (3-part) were distinct matchers.
- **Static segment beats nothing — literals must be equal** — for `/gateways/:name/sessions/:id`, the 3rd segment (`sessions`) is a **static literal** and must equal `sessions` exactly. `GET /gateways/g/widgets/s` does NOT match (literal `sessions` ≠ `widgets`) → matcher returns `null`. This preserves the old `if (sessionsLiteral !== "sessions") return null`.
- **`:param` never matches an empty segment** — a placeholder requires a **non-empty** captured string. `GET /gateways/` (which normalizes to `/gateways`, see trailing-slash rule) does NOT match `/gateways/:name` because the `:name` slot would be empty. This reproduces every old matcher's `if (segment.length === 0) return null` guard. The path falls through to the no-route outcome instead of matching with an empty param.
- **Trailing-slash normalization (strip exactly one)** — before matching, the caller normalizes the path by removing **at most one** trailing `/`, except the root `/` which is preserved. Therefore:
  - `GET /gateways/` → normalized `/gateways` → matches `GET /gateways` (params `{}`).
  - `GET /gateways/hermes/` → `/gateways/hermes` → matches `/gateways/:name`.
  - `GET /gateways/hermes/sessions/ses_X/` → matches `/gateways/:name/sessions/:id`.
  - `GET /` stays `/` and matches `GET /`.
  This reproduces every old matcher's `rest.endsWith("/") ? rest.slice(0, -1) : rest` step. The behavior is verified today by `gateways.test.ts` ("treats GET /gateways/ the same as GET /gateways"), `sessions.test.ts` ("treats trailing slash equivalently"), and `search-endpoint.test.ts` ("GET /sessions/?q=login").
- **Query string is NOT part of matching** — the caller strips everything from the first `?` to obtain the path used for matching, and forwards the raw query string separately to the handler. So `GET /sessions?q=login` and `GET /sessions/?q=login` both match the `/sessions` route; `GET /gateways/hermes/sessions?q=login` matches `/gateways/:name/sessions`. This preserves `stripQueryString` + the `queryString` argument threaded into search and message-history handlers.
- **No regex / no wildcard / no priority / no nested routers** (issue #108 §设计约束① + RFC #107 作者倾向③) — the matcher MUST NOT support: regular-expression segments, `*` catch-alls, optional segments, per-route priority ordering, or sub-router mounting. A pattern segment is either a static literal or a `:name` placeholder — nothing else. Any future need for these is explicitly out of scope and must be rejected in review.
- **Pure structural equivalence** — for every path the old hand-written `matchXxx(path)` functions accepted/rejected, the new matcher returns the corresponding match/`null`. This is a behavior-preserving refactor: matcher inputs→outputs are identical to `matchGatewayDetail`, `matchSessionsCollection`, `matchSessionDetail`, `matchSessionMessages`, `matchSessionExport`, and `matchOcasObject`.

## Verification
- A new unit test file (e.g. `packages/server/tests/router.test.ts`) exercises the matcher directly (no HTTP server needed), covering: static match, single `:param`, multi-`:param`, segment-count disambiguation, static-literal mismatch → `null`, empty-param rejection → `null`, and trailing-slash normalization. (Issue #108 Step 4: "静态段匹配、:param 提取、trailing slash 处理".)
- `pnpm --filter @sumeru/server test` stays green (full suite zero regression).
- `pnpm run typecheck` and `pnpm run check` exit 0 — the router is fully typed (no `any`) and Biome-clean, per CLAUDE.md (strict TS, `type` over `interface`, `function` over `class`, named exports, `.js` import paths).
</content>
</invoke>
