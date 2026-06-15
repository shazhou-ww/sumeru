---
id: server-ocas-integration
title: "Ocas Integration"
sources:
  - packages/server/src/ocas/store.ts
  - packages/server/src/ocas/schemas.ts
  - packages/server/src/ocas/index.ts
tags: [architecture, server, ocas, cas, storage]
created: 2026-06-15
updated: 2026-06-15
---

# Ocas Integration

The `packages/server/src/ocas/` module wraps the `@ocas/core` and `@ocas/fs` content-addressed store for Sumeru's recording needs. It handles store initialization, schema registration, payload validation, and provides the `recordPayload` function used by both session creation and the SSE message endpoint.

## Store Initialization

`openSumeruOcas(dir: string)` opens (or creates) the on-disk CAS store:

1. **Create directory** — `mkdirSync(dir, { recursive: true })`
2. **Open CAS** — `createFsStore(dir)` from `@ocas/fs`
3. **Open SQLite** — `createSqliteVarStore(dir, cas)` for var/tag stores
4. **Bootstrap** — `bootstrap(store)` from `@ocas/core` registers the schema-of-schemas (`@ocas/schema`)
5. **Register Sumeru schemas** — `putSchema(store, schema)` for `@sumeru/turn` and `@sumeru/session-meta`
6. **Build schema aliases** — hash → human name map for the `/ocas/:hash` endpoint
7. **Open search index** — `createSearchIndex(join(dir, "_store.db"))` (FTS5 in the same SQLite DB)

Returns a `SumeruOcas` object containing all handles and hashes:

```typescript
type SumeruOcas = {
  store: Store;
  turnSchemaHash: Hash;
  sessionMetaSchemaHash: Hash;
  metaSchemaHash: Hash;              // @ocas/schema (schema-of-schemas)
  schemaAliases: Record<Hash, string>;
  searchIndex: SearchIndex;
};
```

Any failure during initialization throws with a uniform message: `"failed to open ocas store at <dir>: <cause>"`.

## Registered Schemas

### @sumeru/turn

Records a single turn (user or assistant). Fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `index` | integer ≥ 0 | ✓ | Turn sequence number |
| `role` | `"user" \| "assistant"` | ✓ | No "system" — not recorded |
| `content` | string | ✓ | Full text content |
| `timestamp` | string (date-time) | ✓ | ISO 8601 |
| `toolCalls` | null \| ToolCall[] | ✓ | Each ToolCall has: tool, input, output, durationMs, exitCode |
| `tokens` | null \| {input, output} | optional | Token usage (omitted when null) |

`additionalProperties: false` — the server strips `hash` (would be circular) before writing.

### @sumeru/session-meta

Written once at session create. Fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | string | ✓ | Pattern: `^ses_[0-9A-HJKMNP-TV-Z]{26}$` |
| `gateway` | string (minLength 1) | ✓ | |
| `adapter` | string (minLength 1) | ✓ | |
| `createdAt` | string (date-time) | ✓ | |
| `config` | object | ✓ | Opaque adapter config blob (verbatim from client) |
| `resolvedCwd` | null \| string (minLength 1) | ✓ | Server-resolved CWD (null if no cwd hint) |

`additionalProperties: false` — no extra fields at top level; adapter-specific data lives inside `config`.

## Payload Validation

`@ocas/core`'s `Store.cas.put` does **not** validate payloads — it just hashes and stores. Sumeru enforces validation before writing via its own ajv instance:

```typescript
function validatePayload(store: Store, schemaHash: Hash, payload: unknown): void
function recordPayload(store: Store, schemaHash: Hash, payload: unknown): Hash
```

`recordPayload` = validate + put. Throws `SchemaValidationError` on invalid payloads.

### Custom Ajv Instance

A local `ajv` (separate from `@ocas/core`'s internal one) with two custom formats:
- `ocas_ref` — Crockford Base32 hash pattern: `/^[0-9A-HJKMNP-TV-Z]{13}$/`
- `date-time` — permissive ISO 8601 regex matching `Date.prototype.toISOString()` output

No dependency on `ajv-formats` — just these two server-produced formats.

## Schema Aliases

The `/ocas/:hash` endpoint resolves schema hashes to human-readable type names:

```typescript
schemaAliases: {
  [metaSchemaHash]: "@ocas/schema",
  [turnSchemaHash]: "@sumeru/turn",
  [sessionMetaSchemaHash]: "@sumeru/session-meta",
}
```

When a CAS node's `type` field matches a known schema hash, the HTTP response shows the alias instead (e.g. `"type": "@sumeru/turn"` rather than a raw 13-char hash).

## Schema Immutability

Schema bodies are **byte-stable contracts** — the hash is derived from the schema content. Changing field order, adding properties, or modifying constraints produces a new hash and breaks backward compatibility. These definitions are treated as immutable once deployed.

## How Other Modules Use Ocas

| Caller | Function | Schema |
|--------|----------|--------|
| Session store (`create`) | `recordPayload` | `@sumeru/session-meta` |
| SSE messages (user turn) | `recordPayload` | `@sumeru/turn` |
| SSE messages (assistant turns) | `recordPayload` | `@sumeru/turn` |
| `/ocas/:hash` handler | `store.cas.get` | (read-only, any type) |

## Module Exports

`ocas/index.ts` re-exports:
- `SUMERU_SESSION_META_SCHEMA`, `SUMERU_TURN_SCHEMA` (schema definitions)
- `openSumeruOcas`, `recordPayload`, `validatePayload`, `getRegisteredSchema`
- `SumeruOcas` type
