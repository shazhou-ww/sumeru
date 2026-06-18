---
scenario: "SUMERU_TURN_SCHEMA_HASH and SUMERU_SESSION_META_SCHEMA_HASH are statically importable named constants from @sumeru/server"
feature: server-ocas
tags: [ocas, schema, hash, export, static-import]
---

## Given
- `@ocas/core` exposes `computeSelfHashSync(payload): Hash` which deterministically computes a 13-char Crockford Base32 hash from a JSON Schema body using CBOR-deterministic + XXH64.
- The schema bodies (`SUMERU_TURN_SCHEMA`, `SUMERU_SESSION_META_SCHEMA`) are byte-stable object literals defined in `packages/server/src/ocas/schemas.ts`.
- `@ocas/core.initHasher()` must be awaited once before `computeSelfHashSync` can be called.
- The existing `server-ocas-store-bootstrap.md` spec says hashes are exposed as named constants, but the current implementation only computes them at runtime inside `openSumeruOcas()` and attaches them to the returned `SumeruOcas` object — they are NOT importable as module-level constants.
- Consumers (e.g. tests, tooling, external packages) need to reference these hashes without calling `openSumeruOcas()` or booting a full store.

## When
- A consumer writes:
  ```typescript
  import {
    SUMERU_TURN_SCHEMA_HASH,
    SUMERU_SESSION_META_SCHEMA_HASH,
  } from "@sumeru/server";
  ```
- Or imports from the ocas submodule directly:
  ```typescript
  import {
    SUMERU_TURN_SCHEMA_HASH,
    SUMERU_SESSION_META_SCHEMA_HASH,
  } from "@sumeru/server/ocas"; // if subpath export exists
  ```

## Then
- **Module-level constants** — `packages/server/src/ocas/schemas.ts` exports two additional named constants alongside the schema bodies:
  ```typescript
  // packages/server/src/ocas/schemas.ts
  export const SUMERU_TURN_SCHEMA_HASH: Hash = "<computed>";
  export const SUMERU_SESSION_META_SCHEMA_HASH: Hash = "<computed>";
  ```
  The values are hardcoded string literals (pre-computed from `computeSelfHashSync` applied to the schema bodies). They are NOT computed at import time — no `initHasher()` call is required to import them.
- **Why hardcoded** — `computeSelfHashSync` requires a WASM init step (`initHasher()`). A top-level `await` or lazy init at module scope would force all importers to handle async initialization. Hardcoding the hashes as string constants makes them zero-cost imports. A test asserts they stay in sync (see below).
- **Hash format** — Both constants match the regex `^[0-9A-HJKMNP-TV-Z]{13}$` (13-char Crockford Base32).
- **Hash values are distinct** — `SUMERU_TURN_SCHEMA_HASH !== SUMERU_SESSION_META_SCHEMA_HASH`.
- **Re-export from ocas/index.ts** — `packages/server/src/ocas/index.ts` re-exports both constants:
  ```typescript
  export {
    SUMERU_SESSION_META_SCHEMA,
    SUMERU_SESSION_META_SCHEMA_HASH,
    SUMERU_TURN_SCHEMA,
    SUMERU_TURN_SCHEMA_HASH,
  } from "./schemas.js";
  ```
- **Re-export from package entry** — `packages/server/src/index.ts` includes both hash constants in its named exports (alongside the already-exported schema bodies):
  ```typescript
  export {
    // ...existing...
    SUMERU_SESSION_META_SCHEMA,
    SUMERU_SESSION_META_SCHEMA_HASH,
    SUMERU_TURN_SCHEMA,
    SUMERU_TURN_SCHEMA_HASH,
    // ...
  } from "./ocas/index.js";
  ```
- **`openSumeruOcas` unchanged** — The function continues to return `turnSchemaHash` and `sessionMetaSchemaHash` on the `SumeruOcas` object (no breaking change). Internally it MAY reference the new constants instead of calling `putSchema` for the hash value, but `putSchema` is still called for the side effect of registering the schema in the store. The returned hash values equal the exported constants.
- **Consistency test** — A test in `packages/server/tests/ocas-schema-hash-constants.test.ts` asserts:
  1. `await initHasher()` succeeds.
  2. `computeSelfHashSync(SUMERU_TURN_SCHEMA) === SUMERU_TURN_SCHEMA_HASH`.
  3. `computeSelfHashSync(SUMERU_SESSION_META_SCHEMA) === SUMERU_SESSION_META_SCHEMA_HASH`.
  4. Both constants match `^[0-9A-HJKMNP-TV-Z]{13}$`.
  5. The two constants are not equal to each other.
  This test guarantees that if the schema body is modified without updating the hash constant, CI fails immediately.
- **No runtime behavior change** — Existing code paths that read hashes from `SumeruOcas.turnSchemaHash` / `SumeruOcas.sessionMetaSchemaHash` continue to work identically. The store bootstrap still calls `putSchema` and uses the returned hash internally.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
