---
scenario: "Creating a session writes a @sumeru/session-meta node to ocas; closing flips a status pointer; in-memory session record carries the meta hash"
feature: server-ocas
tags: [ocas, session, session-meta, create, close, recording, phase-4]
---

## Given
- Phase-4 bootstrap is in place (`server-ocas-store-bootstrap.md`, `server-ocas-schemas.md`).
- The in-memory session store from Phase 2/3 is unchanged in shape on the wire, but the `Session` type internally gains two fields:
  ```typescript
  type Session = {
    id: string;
    gateway: string;
    status: SessionStatus;
    createdAt: string;
    config: SessionConfig;
    /** Hash of the @sumeru/session-meta node written at create time. */
    metaHash: string;
    /** Latest turn hashes appended to this session, in chronological order. */
    turnHashes: string[];
  };
  ```
  `metaHash` and `turnHashes` are NOT serialized in HTTP envelopes — they're internal. The wire `Session` envelope is unchanged from Phase 2/3.
- The session store's `create(...)` signature now takes the ocas store + schema hashes (or, equivalently, the relevant slice of `ServerConfig.ocas`) so it can `put` the meta synchronously inside `create`.

## When
- The client issues:
  1. `curl -fsS -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:<port>/gateways/hermes/sessions`
  2. `curl -fsS -X POST -H 'Content-Type: application/json' -d '{"config":{"model":"sonnet-4.5"}}' http://127.0.0.1:<port>/gateways/hermes/sessions`
  3. `curl -fsS -X DELETE http://127.0.0.1:<port>/gateways/hermes/sessions/<id-from-1>`
  4. (After closing) `curl -fsS http://127.0.0.1:<port>/ocas/<metaHash>`

## Then
- **Request 1 — create empty config** —
  - HTTP `201` with the same `@sumeru/session` envelope as Phase 2 (no new fields).
  - Inside the server, BEFORE the 201 response is written:
    1. The `Session.id`, `gateway`, `adapter` (resolved from `config.gateways[gateway].adapter`), `createdAt`, and `config` are assembled.
    2. `store.put(SUMERU_SESSION_META_SCHEMA_HASH, payload)` is called once, where `payload` is:
       ```json
       {
         "id": "ses_<ULID>",
         "gateway": "hermes",
         "adapter": "hermes",
         "createdAt": "<ISO-8601>",
         "config": {}
       }
       ```
    3. The returned hash is stored on `Session.metaHash`.
    4. ONLY AFTER the put succeeds is the session inserted into the in-memory map and the 201 written.
  - If `store.put` throws (e.g. validation error against the registered schema, disk full), the server returns `500 ocas_write_failed` with `value.message: "Failed to record session meta: <cause-truncated-to-500>"`. The session is NOT added to the in-memory store. (`Session` is recorded BEFORE the response — atomicity matters.)
- **Request 2 — rich config** — Same flow. The `config` field of the meta payload is the full opaque blob `{ "model": "sonnet-4.5" }`, byte-identical to what the client sent. The hash differs from Request 1's because `config` differs.
- **Request 3 — close** —
  - HTTP `204` (Phase 2 semantics, unchanged).
  - On close, the server writes a SEPARATE node: `store.put(SUMERU_SESSION_STATUS_SCHEMA_HASH, { sessionId, status: "closed", at: <iso> })`.
    Wait — for Phase-4 minimum, **DO NOT** introduce a third schema. Instead, the close path simply mutates the in-memory `status` to `"closed"`. The architecture spec lists "关闭 session 时更新 status" — this update is a state transition the in-memory record carries, NOT an ocas mutation (CAS nodes are immutable). The closed-status fact is observable in two places:
    - `GET /gateways/:name/sessions/:id` returns `status: "closed"` (Phase 2 unchanged).
    - The session-meta node remains UNCHANGED in ocas (immutable). The new status fact is captured implicitly: a closed session contains no further turn nodes. The next phase MAY introduce a `@sumeru/session-event` schema for status transitions; out of scope here.
  - The architecture spec line "关闭 session 时更新 status" is therefore satisfied by the in-memory status flip plus the absence-of-future-turns invariant. NO new ocas write is performed on `DELETE`. (Tests will assert this — see below.)
- **Request 4 — verify meta on disk** — `GET /ocas/<metaHash>` returns:
  ```json
  {
    "type": "@sumeru/session-meta",
    "value": {
      "id": "ses_<ULID>",
      "gateway": "hermes",
      "adapter": "hermes",
      "createdAt": "<ISO-8601>",
      "config": {}
    }
  }
  ```
  The `type` field is rendered with the schema's alias (NOT the hash) only if the response convenience layer translates it; otherwise it is the schema hash. The endpoint contract (in `server-ocas-object-endpoint.md`) is the canonical source — the `value` is what matters here.
- **Adapter rejection path** — Phase 3 wires `adapter.createSession` BEFORE returning 201. The order is:
  1. `adapter.createSession(config)` — if this rejects, return 5xx (Phase 3 unchanged) and write nothing to ocas.
  2. On success, `store.put(meta)` THEN `sessions.create(...)`.
  This guarantees the meta is only persisted for sessions that actually exist on the adapter side.
- **Idempotent close** — Calling `DELETE` twice on the same session is still a 204 + 204 (Phase 2 idempotency). Neither call writes to ocas.
- **`config` round-trip** — A `config` blob containing `{ "weirdField": 42, "nested": { "a": [1, 2, 3] } }` round-trips exactly: `GET /ocas/<metaHash>` returns the same JSON keys/values. (Sumeru does not transform config.)
- **Schema validation on write** — `store.put` invokes `@ocas/core` validation against `SUMERU_SESSION_META_SCHEMA`. A test passes a hand-crafted invalid meta (e.g. missing `adapter`) directly through an internal helper; the call rejects with `SchemaValidationError`. Production code paths cannot trigger this because they always populate all fields, but the contract is exercised.
- **Tests** under `packages/server/tests/ocas-session-meta.test.ts`:
  - Create session → `store.listByType(SUMERU_SESSION_META_SCHEMA_HASH).length` increments by exactly 1.
  - The newly-stored node has `payload` equal to the expected meta object (deep-equal).
  - Two sessions with different config produce two distinct hashes. Two sessions with byte-identical config (same id is impossible because ULID is unique, so same hash is impossible — assertion is "two creates produce two hashes", not "deduped").
  - Close session → `store.listByType(SUMERU_SESSION_META_SCHEMA_HASH).length` is unchanged (no extra meta written). `status` flips in-memory to `"closed"`.
  - `store.put` failure (mocked to throw) on create → 500, NO entry in `sessions.list(gateway)`, NO node in ocas.
  - `Session.metaHash` matches `^[0-9A-HJKMNP-TV-Z]{13}$` after create.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
