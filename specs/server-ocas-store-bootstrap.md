---
scenario: "Sumeru bootstraps an @ocas/fs CAS store at startup, registers @sumeru/turn and @sumeru/session-meta schemas, and exposes the store to all session/message handlers"
feature: server-ocas
tags: [ocas, store, schema, bootstrap, fs, phase-4]
---

## Given
- Phase 3 is complete: `sumeru start --port 0 --config <yaml>` boots a server that holds gateways + sessions + adapters in memory.
- `@ocas/core` and `@ocas/fs` are now declared as **runtime** `dependencies` of `@sumeru/server` (not `devDependencies`):
  ```jsonc
  // packages/server/package.json
  "dependencies": {
    "@sumeru/core": "workspace:*",
    "@ocas/core": "workspace:*",
    "@ocas/fs":   "workspace:*",
    "yaml": "^2.7.0"
  }
  ```
  The workspace links them via the existing `pnpm-workspace.yaml`. `pnpm install` resolves both packages from the local `ocas` workspace (ambient `workspace:*` resolution — same monorepo as Phase 3 adapters). `pnpm-lock.yaml` is updated and committed.
- A new `ServerConfig.ocasDir: string` field carries the on-disk store path. `StartConfig.ocasDir: string | null` is the optional CLI input.
- `sumeru start` accepts `--ocas-dir <path>` (CLI) and falls back to the env var `SUMERU_OCAS_DIR`, then to the default `~/.sumeru/ocas` when neither is set. `~` is expanded against `os.homedir()`.

## When
- The user runs `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml --ocas-dir /tmp/sumeru-ocas-<RND>` (test pattern; real users may omit the flag).
- The server boots and serves at least one request.
- The user issues:
  1. `curl -fsS http://127.0.0.1:<port>/`                 # instance endpoint (Phase 1, unchanged)
  2. `curl -fsS http://127.0.0.1:<port>/gateways`         # gateway list (unchanged)
  3. `curl -fsS http://127.0.0.1:<port>/ocas/<schema-hash-of-@sumeru/turn>`  # NEW — schema retrieval

## Then
- **Store directory bootstrap** —
  - `--ocas-dir` is created on startup if it does not exist (`mkdirSync(dir, { recursive: true })`).
  - `createFsStore({ dir })` from `@ocas/fs` is invoked exactly once per server process; the resulting `Store` is held on the handler closure and shared across all routes.
  - The directory contains the standard `@ocas/fs` layout after startup: `nodes/`, `_index/`, `_meta` file. Sumeru does not invent a custom layout.
  - On filesystem errors (EACCES, ENOSPC, EROFS) `startServer` rejects with a clear error: `"failed to open ocas store at <path>: <cause>"`. The HTTP listener is NOT started.
- **Schema registration** — On every startup (idempotent on reused dirs):
  - Two JSON Schemas are registered via `putSchema` from `@ocas/core`:
    - `@sumeru/session-meta` — see `server-ocas-schemas.md` for shape.
    - `@sumeru/turn`         — see `server-ocas-schemas.md` for shape.
  - Each schema's hash is computed by `@ocas/core`'s deterministic hasher and is stable across restarts AS LONG AS the schema body is byte-identical. The schema hashes are exported from `@sumeru/server` as named constants:
    ```typescript
    export const SUMERU_TURN_SCHEMA_HASH: string;
    export const SUMERU_SESSION_META_SCHEMA_HASH: string;
    ```
    They are 13-character Crockford Base32 strings (matching `^[0-9A-HJKMNP-TV-Z]{13}$`).
  - `putSchema` is called even if the schema already exists in the store — `@ocas/core` deduplicates by hash, so re-registration is a no-op (does NOT throw).
- **Store accessor on the handler** — `createHandler` accepts a new field on `ServerConfig`:
  ```typescript
  type ServerConfig = {
    // ... existing fields ...
    ocas: {
      store: import("@ocas/core").CasStore;
      turnSchemaHash: string;
      sessionMetaSchemaHash: string;
    };
  }
  ```
  The session store, message endpoint, history endpoint, and `/ocas/:hash` endpoint all read `ocas.store` from this config. There is no module-level singleton.
- **Existing endpoints unchanged** —
  - `GET /` returns the same `@sumeru/instance` envelope as Phase 1. The `value` does **not** gain `ocasDir` (implementation detail, not part of the public API).
  - `GET /gateways`, `GET /gateways/:name` are byte-identical to Phase 3.
  - `POST /gateways/:name/sessions`, `GET /gateways/:name/sessions[/:id]`, `DELETE /gateways/:name/sessions/:id` keep their Phase-2 contracts plus the recording behavior in `server-ocas-session-meta.md`. The HTTP envelope for `Session` does NOT gain new fields.
- **`GET /ocas/<schema-hash>`** returns the registered schema as an envelope (full contract in `server-ocas-object-endpoint.md`). Both schema hashes resolve.
- **CLI flag plumbing** —
  - `sumeru start --help` lists `--ocas-dir <path>` with description "Directory for the ocas content-addressed store (default: $SUMERU_OCAS_DIR or ~/.sumeru/ocas)".
  - When `--ocas-dir` is passed multiple times the last one wins (standard CLI semantics).
  - The resolved absolute path is logged once at startup: `[sumeru] ocas store: /resolved/abs/path`. Logged on stdout, NOT stderr (info-level event).
- **Process lifetime** — The `CasStore` from `@ocas/fs` writes synchronously per the package contract, so no shutdown flush is required. `startedServer.stop()` does NOT need to call `store.close()`. (If `@ocas/fs` ever exposes a `close()`, a follow-up phase wires it; not in this issue.)
- **Tests** under `packages/server/tests/ocas-bootstrap.test.ts`:
  - `startServer` with a fresh tmpdir as `--ocas-dir` succeeds; `nodes/` and `_index/` exist on disk afterwards.
  - The two schema hashes match `^[0-9A-HJKMNP-TV-Z]{13}$` and are byte-stable across two consecutive `startServer` calls in the same test.
  - Re-using the same dir across two test runs does NOT throw and yields the same schema hashes.
  - Pointing `--ocas-dir` at a path that resolves under a non-writable parent (chmod 555) makes `startServer` reject with the documented error and does NOT bind the port.
  - Defaults: when `--ocas-dir` is omitted AND `SUMERU_OCAS_DIR` is unset, the server uses `~/.sumeru/ocas`. Test sets `process.env.HOME = <tmp>` to assert this without writing to the real home dir.
  - `--ocas-dir` overrides `SUMERU_OCAS_DIR` when both are set (CLI > env).
  - `process.env.SUMERU_OCAS_DIR` is honored when `--ocas-dir` is omitted (env > default).
- All Phase-1, Phase-2, Phase-3 tests continue to pass unchanged — except they now have to pass an `ocasDir` (or use the default) when calling `startServer`/`createHandler`. Existing tests are updated to use `mkdtempSync` per test for isolation.
- `pnpm run build`, `pnpm run check`, `pnpm run test` all exit 0.
