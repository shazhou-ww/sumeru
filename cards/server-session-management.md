---
id: server-session-management
title: "Session Store Lifecycle"
sources:
  - packages/server/src/session/store.ts
  - packages/server/src/handler.ts
  - packages/server/src/types.ts
  - packages/server/tests/messages.test.ts
tags: [architecture, server, session, lifecycle]
created: 2026-06-15
updated: 2026-06-23
---

# Session Store Lifecycle

Session lifecycle is managed by `createSessionStore(ocas)` and consumed by HTTP handlers for create/detail/delete/messages.

## Session Model

`Session` includes wire and internal fields:

- wire: `id`, `gateway`, `status`, `createdAt`, `config`
- internal: `metaHash`, `turnHashes`

`toWire(session)` strips internal fields for HTTP responses.

## Status State Machine

`SessionStatus` is `idle | active | closed`.

Transitions enforced by store methods:

- create -> `idle`
- `tryActivate`: `idle -> active`, else `busy|closed|not_found`
- `markIdle`: `active -> idle`, else `not_active|not_found`
- `close`: `idle|active -> closed`, idempotent on already closed

`activeCount` counts non-closed sessions.

## Create Path and Metadata

`store.create(gateway, adapter, config, nativeRef, resolvedCwd)`:

1. generates server session id
2. writes `@sumeru/session-meta` payload to OCAS before registering in memory
3. seeds search index with `metaHash` (best-effort warning on failure)
4. stores session with `status: idle`, `metaHash`, empty `turnHashes`
5. stores `nativeRef` (if present) in internal `nativeRefs` map

The session-meta payload includes `resolvedCwd` so request config and resolved cwd are persisted together.

## Turn Hash Persistence Coupling

`appendTurnHash` persists `(session_id, turn_index, turn_hash)` through `searchIndex.appendSessionTurn` before mutating in-memory `turnHashes`.

If persistence fails, error propagates; memory is not advanced first. This avoids disk/memory divergence.

## Rehydration on Startup

At store construction, `rehydrate()` loads persisted session rows and turn pointers from search index tables, then rebuilds in-memory maps.

- `config` is recovered from immutable session-meta CAS node via `metaHash`
- missing/unreadable meta falls back to `{}` with warnings
- `nativeRef` is intentionally not restored

Result: restarted server can serve historical session state, but rehydrated sessions may lack native adapter refs for new sends.

## Delete/Close Interaction in Handler

`DELETE /gateways/:name/sessions/:id` behavior in `handler.ts`:

- if session exists and has `nativeRef` and adapter and not already closed, attempts `await adapter.close(nativeRef)`
- adapter close errors are swallowed (logical delete still proceeds)
- `sessions.close(...)` runs regardless
- returns `204` for both first close and already-closed (idempotent)

## Message Endpoint Lifecycle Signals

`messages.test.ts` validates key interactions:

- posting to closed session returns `404 session_not_found`
- when adapter send fails, SSE emits `error` and session returns to `idle`
- concurrent sends trigger busy behavior through status transitions

This confirms store transitions are authoritative for session lifecycle under streaming message flows.
