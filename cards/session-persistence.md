---
id: session-persistence
title: "Session Persistence"
sources:
  - packages/server/src/session/store.ts
  - packages/server/src/ocas/schemas.ts
  - README.md
  - specs/server-ocas/server-ocas-session-meta.md
tags: [architecture, server, persistence, session]
created: 2026-06-17
updated: 2026-06-23
---

# Session Persistence

Session persistence is split between immutable OCAS nodes and mutable SQLite index/state tables.

## Persisted Session Metadata

On session create, `createSessionStore.create(...)` writes one `@sumeru/session-meta` node via `recordPayload` before in-memory registration.

Payload fields are:

- `id`
- `gateway`
- `adapter`
- `createdAt`
- `config` (opaque blob)
- `resolvedCwd`

`resolvedCwd` is required by schema and is:

- `null` when no cwd hint was supplied
- non-empty absolute string when cwd was resolved and forwarded

This matches `SUMERU_SESSION_META_SCHEMA` and the spec supersede note for phase-6 behavior.

## In-Memory Session Internals

Each in-memory `Session` carries internal fields:

- `metaHash` (hash of the session-meta node)
- `turnHashes` (ordered turn hash list)

These are never serialized on wire (`toWire` strips them).

## Turn Pointer Persistence

`appendTurnHash` persists `(session_id, turn_index, turn_hash)` through search-index storage before pushing to in-memory `turnHashes`.

This ordering prevents memory/disk divergence when persistence fails.

## Rehydration on Startup

At store construction, `rehydrate()` loads:

- session rows from search-index persistence
- ordered turn pointers in bulk
- session `config` by reading the immutable session-meta node referenced by `metaHash`

If `metaHash` is missing/unreadable, config falls back to `{}` with warning. Rehydrated sessions restore history and status state, but `NativeSessionRef` is not restored.

## Runtime vs Persistent State

Persistent:

- session-meta node
- turn hash pointers
- session status/index rows

Runtime-only:

- `NativeSessionRef` mapping (not persisted)

Operational result (also documented in README): after restart, historical reads work, but posting new messages to sessions without native refs returns adapter-unavailable behavior.
