---
id: architecture-overview
title: "Architecture Overview"
sources:
  - README.md
  - packages/core/src/adapter.ts
  - packages/server/src/types.ts
  - packages/cli/src/build-adapters.ts
tags: [architecture, monorepo, server, adapters]
created: 2026-06-17
updated: 2026-06-23
---

# Architecture Overview

Sumeru is an HTTP "agent house" that normalizes multiple agent backends behind a shared gateway/session model and records interactions in OCAS.

## Layered Structure

Monorepo dependency direction:

- `@sumeru/core` (shared contract/types)
- `@sumeru/server` (HTTP instance/gateway/session/SSE/search/OCAS integration)
- `@sumeru/adapter-*` (backend-specific adapter implementations)
- `@sumeru/cli` (startup/config wiring and adapter registry construction)

## Runtime Model

Core runtime entities:

- `Instance`: one process, one HTTP endpoint
- `Gateway`: named entry with configured adapter + capabilities
- `Session`: server session id (`ses_...`) mapped to adapter-native session ref
- `Turn`: canonical message/tool event unit

Server gateway config carries:

- adapter name
- gateway capabilities (`resume`, `streaming`)
- optional opaque adapter config blob

## Core Adapter Contract (Current)

`@sumeru/core` defines a streaming-first adapter interface:

- `createSession(config: { model: string | null; cwd: string | null })`
- `send(ref, content): AsyncIterable<SendEvent>`
- `close(ref)`
- `getTurns(ref)`

`SendEvent` union:

- `turn`
- `done` (duration + optional tokens)
- `error`

This replaces older single-response send contracts and enables incremental server SSE emission.

## Active Adapter Set

CLI default factories currently wire:

- `hermes`
- `claude-code`
- `codex`
- `cursor-agent`

`buildAdapters()` forwards each gateway's `config` blob verbatim to the matching adapter factory and skips unknown adapter names safely.

## Server Envelope and State

`@sumeru/server` uses envelope responses (`{ type, value }`) and tracks session status via `idle | active | closed` transitions.

Server config includes an OCAS slice with:

- store handle
- registered turn/session-meta schema hashes
- schema aliases
- search index handle

This supports persisted turn/session metadata, `/ocas/:hash` reads, and search rebuild/index operations.

## Persistence and Restart Semantics

Turn nodes, session-meta, and ordered turn-hash pointers persist in OCAS/SQLite-backed storage. On restart, session store rehydrates persisted sessions/turn lists.

Native adapter refs are runtime-only, so historical reads remain available after restart while new sends may be unavailable for sessions lacking re-established adapter refs.
