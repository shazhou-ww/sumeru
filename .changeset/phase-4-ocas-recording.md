---
"@sumeru/core": minor
"@sumeru/server": minor
"@sumeru/cli": minor
---

Phase 4: ocas content-addressed recording.

- `@sumeru/server` now bootstraps an `@ocas/fs`-backed CAS store at startup
  via `openSumeruOcas(dir)`, registers the `@sumeru/turn` and
  `@sumeru/session-meta` JSON Schemas, and exposes the live `Store` plus
  the schema hashes through a new `ServerConfig.ocas` slice.
- New CLI flag `sumeru start --ocas-dir <path>` selects the on-disk store
  location. Resolution: `--ocas-dir` > `$SUMERU_OCAS_DIR` > `~/.sumeru/ocas`.
  The resolved path is logged on startup. Filesystem errors (EACCES,
  ENOSPC, EROFS) reject `startServer` before the listener binds.
- Schema bodies live in `packages/server/src/ocas/schemas.ts` as
  byte-stable contracts. Hashes are computed by `@ocas/core` and exposed
  via `SumeruOcas.{turnSchemaHash, sessionMetaSchemaHash, metaSchemaHash}`.
  Payloads are validated against their schema before they reach disk
  (local ajv with a permissive `date-time` format registered).
- `POST /gateways/:name/sessions` writes a `@sumeru/session-meta` node
  to ocas BEFORE the in-memory session is registered. The hash is held
  internally on `Session.metaHash` and never serialized in the wire
  envelope. Validation/IO failures return `500 ocas_write_failed` and
  leave both the in-memory store AND ocas untouched (atomicity).
- `POST /gateways/:name/sessions/:id/messages` records the user turn
  before invoking `adapter.send`, then records each assistant turn from
  the adapter response. Each turn hash is appended to
  `Session.turnHashes` and stamped onto the SSE `event: turn` payload
  via `value.hash`. The hash is server-injected; it is NOT stored INSIDE
  the ocas payload (would be circular). Adapter failures still leave
  the user turn recorded; concurrent-send 409s write nothing.
- New endpoint `GET /gateways/:name/sessions/:id/messages` returns the
  full ordered turn history sourced from ocas via `Session.turnHashes`,
  wrapped as `@sumeru/message-history`. Supports `?offset` and `?limit`
  (cap 1000); echoes both in the response. Closed sessions remain
  readable. `Cache-Control: no-store`.
- New endpoint `GET /ocas/:hash` returns any node in the store as
  `{ type, value }`. Schema aliases (`@sumeru/turn`,
  `@sumeru/session-meta`, `@ocas/schema`) render `type` as a friendly
  name; unknown types fall back to the raw hash. Hash format is
  validated via `^[0-9A-HJKMNP-TV-Z]{13}$`. Response carries
  `Cache-Control: public, max-age=31536000, immutable` and
  `ETag: "<hash>"`; `If-None-Match` returns `304 Not Modified` with no
  body. `404 ocas_not_found` for valid-format hashes that miss;
  `400 invalid_hash` for malformed input; `405 method_not_allowed` with
  `Allow: GET` for non-GET methods.
- `@sumeru/core.Turn` gains an optional `hash: string | null` field so
  adapters can return turns without a hash and the server can stamp the
  ocas-computed hash onto SSE / history responses. The hash is excluded
  from the recorded payload.
- `@sumeru/server` now declares `@ocas/core` and `@ocas/fs` as runtime
  dependencies and adds `ajv` for payload pre-validation.
