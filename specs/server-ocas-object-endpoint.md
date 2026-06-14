---
scenario: "GET /ocas/:hash returns the canonical envelope { type, value } for any node in the ocas store, with stable resolution of schema-alias type names"
feature: server-http
tags: [http, ocas, hash, envelope, phase-4]
---

## Given
- The ocas store is bootstrapped per `server-ocas-store-bootstrap.md` and contains:
  - The two registered schemas (hashes `S_meta` and `S_turn`).
  - The schema-of-schemas hash `S_schema` (built into `@ocas/core`).
  - A session-meta node `M1` (written on session create).
  - A turn node `T1` (written by a send).
- A `Hash` is a 13-character Crockford Base32 string matching `^[0-9A-HJKMNP-TV-Z]{13}$`.
- The server holds a small in-process map of "schema hash → human alias" so it can render `type` as `"@sumeru/turn"` (etc.) on the wire instead of an opaque hash. The map is built at startup from the registered schemas:
  ```typescript
  const SCHEMA_ALIASES: Record<Hash, string> = {
    [SUMERU_TURN_SCHEMA_HASH]:         "@sumeru/turn",
    [SUMERU_SESSION_META_SCHEMA_HASH]: "@sumeru/session-meta",
  };
  ```
  The schema-of-schemas hash also gets an alias: `"@ocas/schema"` (the canonical alias for "this node IS a JSON Schema"). Unknown type hashes are rendered as the raw hash string.

## When
- The client issues each of the following:
  1. `curl -fsS -i http://127.0.0.1:<port>/ocas/<T1>`                       # turn node
  2. `curl -fsS -i http://127.0.0.1:<port>/ocas/<M1>`                       # session-meta node
  3. `curl -fsS -i http://127.0.0.1:<port>/ocas/<S_turn>`                   # the turn schema itself
  4. `curl -fsS -i http://127.0.0.1:<port>/ocas/<S_meta>`                   # the session-meta schema
  5. `curl -fsS -i http://127.0.0.1:<port>/ocas/0000000000000`              # valid format, not in store
  6. `curl -sS  -i http://127.0.0.1:<port>/ocas/not-a-hash`                 # invalid format
  7. `curl -sS  -i http://127.0.0.1:<port>/ocas/`                           # empty hash
  8. `curl -sS  -i http://127.0.0.1:<port>/ocas/<T1>/extra`                 # too many path segments
  9. `curl -sS  -i -X POST http://127.0.0.1:<port>/ocas/<T1>`               # disallowed method

## Then
- **Request 1 — turn node** —
  - HTTP `200 OK`, `Content-Type: application/json; charset=utf-8`.
  - Body:
    ```json
    {
      "type": "@sumeru/turn",
      "value": {
        "index": 1,
        "role": "assistant",
        "content": "...",
        "timestamp": "<iso>",
        "toolCalls": [...],
        "tokens": {"input": 100, "output": 20}
      }
    }
    ```
  - `value` is the EXACT payload stored via `store.put` — no `hash` field is added by this endpoint (the client already knows the hash; embedding it would be redundant). This differs from the SSE `event: turn` path, which DOES embed `hash` for client convenience.
  - `type` is rendered as `"@sumeru/turn"` (alias), not the raw schema hash.
- **Request 2 — session-meta node** — HTTP `200`, `type: "@sumeru/session-meta"`, `value` equal to the meta payload (`id`, `gateway`, `adapter`, `createdAt`, `config`). No extra fields.
- **Request 3 — turn schema** —
  - HTTP `200`, body:
    ```json
    {
      "type": "@ocas/schema",
      "value": { /* the JSON Schema body of @sumeru/turn from server-ocas-schemas.md */ }
    }
    ```
  - `value` is the literal JSON Schema object — fully expanded, key order matches the source declaration in `packages/server/src/ocas/schemas.ts`.
- **Request 4 — session-meta schema** — HTTP `200`, same shape, schema body of `@sumeru/session-meta`.
- **Request 5 — valid format but not present** —
  - HTTP `404 Not Found`, body:
    ```json
    {
      "type": "@sumeru/error",
      "value": {
        "error": "ocas_not_found",
        "message": "No ocas node found for hash '0000000000000'"
      }
    }
    ```
  - The error code `ocas_not_found` is distinct from `gateway_not_found` and `session_not_found` so callers can distinguish.
- **Request 6 — invalid hash format** —
  - HTTP `400 Bad Request`, body:
    ```json
    {
      "type": "@sumeru/error",
      "value": {
        "error": "invalid_hash",
        "message": "Hash must be a 13-character Crockford Base32 string (got 'not-a-hash')"
      }
    }
    ```
  - The validation regex is `^[0-9A-HJKMNP-TV-Z]{13}$` (Crockford alphabet, uppercase). Any deviation — wrong length, lowercase letters, characters `I`/`L`/`O`/`U` — fails the check.
- **Request 7 — empty hash** —
  - The path `/ocas/` (with trailing slash) returns `404 Not Found` with the generic route-not-matched envelope (`value.error: "route_not_found"`), consistent with the existing 404 path in `handler.ts`. It does NOT return `invalid_hash` — there is no hash to validate.
  - The path `/ocas` (no trailing slash) is also `404` (no listing endpoint at this path).
- **Request 8 — extra path segments** — `/ocas/<hash>/extra` is `404 route_not_found`. The endpoint is strictly `GET /ocas/<13-char-hash>`; nested paths are not defined.
- **Request 9 — disallowed method** — HTTP `405 method_not_allowed` with `Allow: GET` and `@sumeru/error` envelope (`value.error: "method_not_allowed"`).
- **Trailing slash on hash** — `GET /ocas/<hash>/` is normalized to `GET /ocas/<hash>` (200 if found, 404 if not).
- **Case sensitivity** — Hashes are uppercase by `@ocas/core` contract. The endpoint does NOT case-fold: `GET /ocas/abcdefghjkmnp` (lowercase) returns `400 invalid_hash`. (Crockford Base32 alphabet is uppercase only in this codebase.)
- **Unknown schema alias** — A node whose `type` hash is NOT one of `S_turn` / `S_meta` / `S_schema` is rendered with the raw hash as `type`. Example payload:
  ```json
  {
    "type": "<13-char-hash>",
    "value": <whatever-payload>
  }
  ```
  This future-proofs the endpoint: phases that introduce new schemas can add aliases; until then, raw hashes are still resolvable.
- **Schema-of-schemas case** — `GET /ocas/<S_schema>` (the schema-of-schemas hash, used by `@ocas/core` to mark JSON Schema nodes) returns `type: "@ocas/schema"` with `value` being the schema-of-schemas body. This is exposed for completeness; the server simply forwards what `store.get(S_schema)` returns.
- **Response size discipline** — There is no max-payload guard in Phase 4. (If a future phase records very large turns, an opt-in `?fields=metadata` projection MAY be added; not in scope here.)
- **CORS / caching** —
  - `Cache-Control: public, max-age=31536000, immutable` — ocas nodes are content-addressed and immutable, so aggressive caching is safe and correct. (In contrast, the message-history endpoint uses `no-store` because that response is a moving snapshot of `Session.turnHashes`.)
  - `ETag: "<hash>"` — the hash IS the ETag. A conditional `If-None-Match: "<hash>"` returns `304 Not Modified` (no body), wrapped to be consistent with the rest of the API.
- **Tests** under `packages/server/tests/ocas-object-endpoint.test.ts`:
  - Each of the 9 request cases above asserts the documented response (status + body shape).
  - Round-trip: a session-create produces `metaHash`, then `GET /ocas/<metaHash>` returns the meta with byte-identical `config`.
  - Round-trip: an SSE turn event's `value.hash` is followed by `GET /ocas/<hash>` and the value matches the SSE payload (minus the `hash` field).
  - Schema fetches: `GET /ocas/<S_turn>` returns `type: "@ocas/schema"` and `value.title === "@sumeru/turn"`.
  - Conditional GET: a request with `If-None-Match: "<hash>"` returns 304 with empty body and `ETag: "<hash>"`.
  - The `Cache-Control` header is set on success responses.
- All Phase-1/2/3/4 tests continue to pass.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
