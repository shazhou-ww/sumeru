---
id: server-ocas-integration
title: "Server OCAS Integration"
sources:
  - packages/server/src/ocas/schemas.ts
  - packages/server/src/ocas/index.ts
  - packages/server/src/index.ts
  - packages/server/tests/ocas-schema-hash-constants.test.ts
  - packages/server/tests/ocas-schemas.test.ts
tags: [architecture, server, ocas, schemas, storage]
created: 2026-06-15
updated: 2026-06-23
---

# Server OCAS Integration

`@sumeru/server` integrates OCAS by defining byte-stable JSON schemas, registering them at startup, and exporting both schema bodies and schema-hash constants for consumers.

## Exported Schema Contracts

`packages/server/src/ocas/schemas.ts` defines:

- `SUMERU_SESSION_META_SCHEMA`
- `SUMERU_TURN_SCHEMA`

and now also exports hardcoded hash constants:

- `SUMERU_SESSION_META_SCHEMA_HASH = "5C30THA7BZ814"`
- `SUMERU_TURN_SCHEMA_HASH = "718S3WF704TZ6"`

These constants avoid requiring runtime hasher initialization at import sites.

## Session-Meta Schema Updates

`@sumeru/session-meta` requires:

- `id`, `gateway`, `adapter`, `createdAt`, `config`, `resolvedCwd`

Notable constraints:

- `additionalProperties: false`
- `resolvedCwd` is required and must be `null` or non-empty string
- top-level opaque fields are disallowed; adapter-specific data remains inside `config`

## Turn Schema Shape

`@sumeru/turn` remains a strict object schema with:

- required: `index`, `role`, `content`, `timestamp`, `toolCalls`
- `role` limited to `user | assistant`
- nullable tool-call result fields (`output`, `durationMs`, `exitCode`)
- optional nullable `tokens` object with non-negative integers

## Public Exports and Re-exports

`packages/server/src/ocas/index.ts` re-exports schema bodies and hash constants, and `packages/server/src/index.ts` re-exports them from the package root. Consumers can import either path.

## Hash Constant Verification

`packages/server/tests/ocas-schema-hash-constants.test.ts` validates:

- each hash constant equals `computeSelfHashSync(schemaBody)`
- both constants match Crockford Base32 hash regex
- constants are distinct from each other

This protects against accidental schema-body edits without updating constants.

## Schema Validation Coverage

`packages/server/tests/ocas-schemas.test.ts` covers:

- schema literal required-field expectations
- deterministic registration hashes across startups
- valid/invalid payload matrix for turn/session-meta
- `resolvedCwd` required behavior
- `recordPayload` storing valid payloads and returning CAS hashes

Together these tests lock schema compatibility and runtime OCAS write behavior.
