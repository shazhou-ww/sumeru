---
"@sumeru/server": minor
---

Phase 2: session lifecycle endpoints.

- New `POST /gateways/:name/sessions` creates an in-memory session and returns
  a `@sumeru/session` envelope with HTTP 201. Session IDs are `ses_` + a
  26-character Crockford Base32 ULID, generated server-side. Client-supplied
  `id` fields in the request body are ignored.
- The `config` field of the request body is treated as **opaque**: Sumeru
  passes it through verbatim (preserves unknown keys, never validates,
  normalizes, or renames). Empty/missing bodies are equivalent to `{}`.
  Malformed JSON returns `400 invalid_json`; a non-object `config` returns
  `400 invalid_request`.
- New `GET /gateways/:name/sessions` returns a `@sumeru/session-list` envelope.
  Listings are scoped per gateway, ordered by creation, omit `config`, and
  **include closed sessions**.
- New `GET /gateways/:name/sessions/:id` returns a full `@sumeru/session`
  envelope (including `config`). Lookups are scoped to the gateway: requesting
  a session under a different gateway returns `404 session_not_found`.
- New `DELETE /gateways/:name/sessions/:id` flips the session's status to
  `closed` and returns `204 No Content`. Deletes are **idempotent** —
  re-closing a closed session is a 204 no-op. Closed sessions remain
  queryable (status `closed`) for inspection.
- Status state machine: `idle → active → idle | closed`, with a typed
  `SessionStatus = "idle" | "active" | "closed"`. Helpers `tryActivate` and
  `markIdle` on the session store define the 409 `session_busy` contract for
  the future message endpoint (currently unit-tested via the helper).
- `GET /gateways` and `GET /gateways/:name` now report `activeSessions` as the
  count of non-closed sessions on the gateway, replacing the Phase-1
  hard-coded `0`.
- All Phase-2 success bodies are `{ type, value }` envelopes; all failures use
  `@sumeru/error` with stable codes (`gateway_not_found`, `session_not_found`,
  `invalid_json`, `invalid_request`, `method_not_allowed`, `session_busy`).
  Method mismatches return 405 with a populated `Allow` header.
