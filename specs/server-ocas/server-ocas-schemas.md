---
scenario: "@sumeru/turn and @sumeru/session-meta JSON Schemas have stable, fully specified shapes that drive ocas validation"
feature: server-ocas
tags: [ocas, schema, turn, session-meta, json-schema, phase-4]
---

## Given
- The store is bootstrapped per `server-ocas-store-bootstrap.md`.
- `@ocas/core` exposes `putSchema` (registers a schema and returns its hash) and `validate` (validates a payload against a schema).
- The architecture spec (`specs/architecture.md`) declares two schemas as part of the recording surface:
  - `@sumeru/session-meta` — the per-session metadata snapshot.
  - `@sumeru/turn`         — a single turn (user OR assistant), the same shape as `Turn` from `@sumeru/core`.

## When
- `@sumeru/server` starts and registers both schemas via `putSchema`.
- A consumer calls `validate(<payload>, <schema>)` against either schema with various payloads.
- A consumer calls `GET /ocas/<schema-hash>` to fetch the schema body.

## Then
- **`@sumeru/session-meta` schema** — exact JSON Schema body (this is the byte-stable contract that determines the schema hash):
  ```json
  {
    "title": "@sumeru/session-meta",
    "description": "Per-session metadata snapshot. Written once at session create.",
    "type": "object",
    "additionalProperties": false,
    "required": ["id", "gateway", "adapter", "createdAt", "config"],
    "properties": {
      "id": { "type": "string", "pattern": "^ses_[0-9A-HJKMNP-TV-Z]{26}$" },
      "gateway": { "type": "string", "minLength": 1 },
      "adapter": { "type": "string", "minLength": 1 },
      "createdAt": { "type": "string", "format": "date-time" },
      "config": { "type": "object" }
    }
  }
  ```
  - `additionalProperties: false` is intentional — opaque adapter config lives **inside** `config`, not at the top level. The whole `config` object is then permitted because it has no nested `additionalProperties` constraint.
  - `status` is deliberately omitted from the meta — the meta is a one-shot snapshot at create time. Closing a session writes a different node (see `server-ocas-session-meta.md`); it does not mutate this one.
- **`@sumeru/turn` schema** — exact JSON Schema body:
  ```json
  {
    "title": "@sumeru/turn",
    "description": "One turn in a session — a user message OR an assistant response.",
    "type": "object",
    "additionalProperties": false,
    "required": ["index", "role", "content", "timestamp", "toolCalls"],
    "properties": {
      "index":     { "type": "integer", "minimum": 0 },
      "role":      { "type": "string", "enum": ["user", "assistant"] },
      "content":   { "type": "string" },
      "timestamp": { "type": "string", "format": "date-time" },
      "toolCalls": {
        "anyOf": [
          { "type": "null" },
          {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["tool", "input", "output", "durationMs", "exitCode"],
              "properties": {
                "tool":       { "type": "string", "minLength": 1 },
                "input":      { "type": "object" },
                "output":     { "anyOf": [{ "type": "null" }, { "type": "string" }] },
                "durationMs": { "anyOf": [{ "type": "null" }, { "type": "integer", "minimum": 0 }] },
                "exitCode":   { "anyOf": [{ "type": "null" }, { "type": "integer" }] }
              }
            }
          }
        ]
      },
      "tokens": {
        "anyOf": [
          { "type": "null" },
          {
            "type": "object",
            "additionalProperties": false,
            "required": ["input", "output"],
            "properties": {
              "input":  { "type": "integer", "minimum": 0 },
              "output": { "type": "integer", "minimum": 0 }
            }
          }
        ]
      }
    }
  }
  ```
  - `tokens` is the only optional property (because `Turn.tokens` in `@sumeru/core` is an optional `TokenUsage`). When present it must be a fully-specified TokenUsage; when absent the property is simply missing (NOT `null`).
  - `role` enum is exactly `["user", "assistant"]` — `"system"` from `@sumeru/core.Turn` is excluded because Sumeru does not record system turns through the message endpoint.
  - `toolCalls` is required: the `null` form represents a user turn or an assistant turn with no tool calls. Skipping the field is invalid.
  - Inside a tool-call item, `output` and `durationMs` accept `null` — adapters may emit `null` when the tool produced no textual output or when timing data is unavailable. `exitCode` already accepted `null`.
- **Schema hashes** — Both schemas, when serialized via `@ocas/core`'s deterministic CBOR encoder, produce 13-character Crockford Base32 hashes that match `^[0-9A-HJKMNP-TV-Z]{13}$`. The hashes are exposed as named constants:
  ```typescript
  // packages/server/src/ocas/schemas.ts
  export const SUMERU_SESSION_META_SCHEMA: JSONSchema = { /* exact body above */ };
  export const SUMERU_TURN_SCHEMA: JSONSchema = { /* exact body above */ };
  // hashes computed at module load via @ocas/core.computeSelfHashSync
  export const SUMERU_SESSION_META_SCHEMA_HASH: Hash;
  export const SUMERU_TURN_SCHEMA_HASH: Hash;
  ```
- **Validation behavior — `validate(payload, schema)` returns:**
  - `true` for: a turn with `role="user"`, `toolCalls=null`, no `tokens`.
  - `true` for: a turn with `role="assistant"`, `toolCalls=[{tool:"terminal",input:{...},output:"...",durationMs:50,exitCode:0}]`, `tokens={input:100,output:50}`.
  - `true` for: a turn with `role="assistant"`, `toolCalls=[{tool:"bash",input:{...},output:null,durationMs:null,exitCode:null}]` — null `output` and `durationMs` are valid.
  - `false` for: missing `toolCalls` (required even when `null`).
  - `false` for: `role="system"` (not in enum).
  - `false` for: `tokens.input = -1` (minimum 0 violated).
  - `false` for: `durationMs = -1` (minimum 0 violated when non-null).
  - `false` for: a session-meta with `status` set (additionalProperties false).
- **Round-trip via `GET /ocas/<schema-hash>`** — Both schema hashes return:
  ```json
  {
    "type": "<schema-of-schema-hash>",
    "value": { /* the exact JSON Schema body above */ }
  }
  ```
  The `type` field is the hash of `@ocas/core`'s built-in schema-of-schemas; clients can also fetch THAT hash to validate the schema body itself, but Sumeru does not test that recursion.
- **Tests** under `packages/server/tests/ocas-schemas.test.ts`:
  - Each schema body is byte-stable across two `JSON.stringify` round-trips (key order matters for `@ocas/core`'s hasher; the implementation uses object literals with declared key order).
  - Each schema hash matches the regex above.
  - The hashes are NOT equal to each other (different schemas).
  - Hash bytes are deterministic across two startups in the same test.
  - The valid/invalid payload table above is asserted exhaustively.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
