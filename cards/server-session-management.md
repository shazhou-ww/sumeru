---
id: server-session-management
title: "Session Management"
sources:
  - packages/server/src/session/store.ts
  - packages/server/src/session/id.ts
  - packages/server/src/session/cwd.ts
  - packages/server/src/session/index.ts
tags: [architecture, server, session, state-machine]
created: 2026-06-15
updated: 2026-06-15
---

# Session Management

The `packages/server/src/session/` module implements in-memory session lifecycle, ID generation, and CWD resolution. Sessions are scoped per-gateway and persist only within the process (no disk persistence at this layer).

## Session State Machine

```
                   POST .../sessions
                         │
                         ▼
                      ┌──────┐
         ┌───────────│ idle │◄────────────┐
         │           └──────┘             │
         │              │                 │
    DELETE│    POST .../messages      markIdle
         │              │                 │
         │              ▼                 │
         │          ┌────────┐            │
         ├──────────│ active │────────────┘
         │          └────────┘
         │              │
         ▼              ▼ DELETE
      ┌────────┐
      │ closed │  (terminal, idempotent)
      └────────┘
```

Transitions are enforced by the store — `tryActivate` and `markIdle` return discriminated unions with typed failure reasons:

| Transition | Method | Failure Reasons |
|-----------|--------|-----------------|
| idle → active | `tryActivate` | `busy` (already active), `closed`, `not_found` |
| active → idle | `markIdle` | `not_active`, `not_found` |
| any → closed | `close` | returns `"already_closed"` or `"not_found"` (no error) |

## Session ID Generation

Format: `ses_` + 26-character ULID (Crockford Base32, uppercase).

```
ses_01H5EXAMPLE00000000000000
│    │          │
│    │          └── 16 random chars (5-bit each)
│    └── 10 timestamp chars (ms since epoch)
└── prefix
```

Properties:
- **Total length**: 30 characters (4 prefix + 26 body)
- **Lexicographically sortable** by creation time
- **Monotonic**: within the same millisecond, the random component is incremented (not re-randomized) to guarantee strict ordering
- **Overflow safety**: if the 16-char random component overflows (astronomically unlikely), falls back to a fresh random vector

The Crockford Base32 alphabet excludes I, L, O, U to avoid ambiguity.

## In-Memory Store

`createSessionStore(ocas)` returns a closure-based store over:
- `byGateway: Map<gateway, Map<id, Session>>` — scoped per gateway, insertion-ordered (chronological listings)
- `nativeRefs: Map<"gateway\0id", NativeSessionRef>` — internal adapter handles, never exposed via HTTP

### Store API

| Method | Signature | Description |
|--------|-----------|-------------|
| `create` | `(gateway, adapter, config, nativeRef, resolvedCwd) → Session` | Generate ID, write ocas meta, register session |
| `list` | `(gateway) → Session[]` | Insertion-ordered listing |
| `get` | `(gateway, id) → Session \| null` | Single lookup |
| `getNativeRef` | `(gateway, id) → NativeSessionRef \| null` | Internal: retrieve adapter handle |
| `appendTurnHash` | `(gateway, id, hash) → void` | Append a turn hash (no-op if session gone) |
| `close` | `(gateway, id) → "closed" \| "already_closed" \| "not_found"` | Terminal state transition |
| `activeCount` | `(gateway) → number` | Count non-closed sessions |
| `tryActivate` | `(gateway, id) → TransitionResult<…>` | Attempt idle → active |
| `markIdle` | `(gateway, id) → TransitionResult<…>` | Mark active → idle |

### Create Flow

1. Generate a `ses_` + ULID ID
2. Write `@sumeru/session-meta` to ocas (atomic — fails the create if write fails)
3. Best-effort seed the search index (failure logged, not propagated)
4. Register in-memory session with status `idle`
5. Store the `NativeSessionRef` keyed by `gateway\0id`

### Wire Serialization

`toWire(session)` strips internal fields (`metaHash`, `turnHashes`) from the `Session` type, producing a `SessionWire` for HTTP envelope responses.

## CWD Resolution

`resolveSessionCwd(workspaceRoot, rawCwd)` enforces path confinement before the adapter sees the CWD:

| rawCwd | workspaceRoot | Result |
|--------|---------------|--------|
| undefined / null / `""` | any | `{ ok: true, cwd: null }` |
| non-string | any | `{ ok: false }` (type error) |
| relative path | non-null | `path.resolve(root, raw)`, rejected if escapes root |
| absolute path | non-null | resolved and confined within root |
| absolute path | null | passed through verbatim |
| relative path | null | `{ ok: false }` (no root to resolve against) |

**Security invariant**: when `workspaceRoot` is set, no session can reference a CWD outside that directory tree. The check uses `resolved.startsWith(root + path.sep)` to prevent prefix-collision attacks (e.g. `/workspace-evil` matching `/workspace`).

The resolved CWD replaces the user-supplied value in the config blob forwarded to the adapter. The original wire envelope returned to the client is left untouched.

## Module Exports

`session/index.ts` re-exports:
- `resolveSessionCwd` + `ResolveCwdResult`
- `generateSessionId`
- `SessionStore` + `TransitionResult` (types)
- `createSessionStore`
