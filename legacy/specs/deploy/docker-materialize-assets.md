---
scenario: "@sumeru/server exports materializeDockerAssets(targetDir) — copying the three packaged docker templates verbatim (zero rendering) into targetDir, returning the written file paths, such that the emitted docker-compose.yaml passes `docker compose config` with mount sources rooted at targetDir"
feature: docker-materialize
tags: [docker, materialize, assets, server-export, compose, zero-render, phase-1, issue-84]
---

## Given

- The branch `fix/84-docker-phase-1` is checked out; the three template files exist under `packages/server/templates/docker/` per `docker-templates.md`, and `@sumeru/server`'s `package.json` `files` includes `"templates"`.
- `@sumeru/server` adds a named export (no default export, project rule):
  ```typescript
  // packages/server/src/docker-assets.ts (re-exported from src/index.ts)
  export function materializeDockerAssets(targetDir: string): string[];
  ```
  - It resolves the template source directory **relative to the compiled module location** (e.g. via `fileURLToPath(import.meta.url)` walking to the package's `templates/docker/`), NOT relative to `process.cwd()`. This makes it work when `@sumeru/server` is installed under `node_modules` of a globally-installed `@sumeru/cli` — the real Docker-mode distribution path, where there is no source tree and `cwd` is arbitrary.
  - It performs a **byte-for-byte copy** (zero string rendering / no interpolation) of each template into `targetDir`. All variability is deferred to compose's native `${VAR:-default}` at run time.
  - Return value is the list of absolute (or `targetDir`-rooted) paths actually written, in a stable order, one per template.
- The function is re-exported from `packages/server/src/index.ts` so consumers do `import { materializeDockerAssets } from "@sumeru/server"`.
- A `docker` / `docker compose` (v2) binary may or may not be present; assertions that need it are gated.

## When

- A unit test creates a fresh temp dir `tmpDir` (e.g. via `mkdtemp`) and calls `materializeDockerAssets(tmpDir)`.
- A unit test calls `materializeDockerAssets` a **second** time against the same `tmpDir`.
- A unit test calls `materializeDockerAssets` against a `targetDir` that does not yet exist.
- (Docker-gated) A test runs `docker compose -f <tmpDir>/docker-compose.yaml config` from within `tmpDir`.

## Then

### Files written verbatim

- After the call, all three files exist in `tmpDir`:
  - `<tmpDir>/Dockerfile`
  - `<tmpDir>/docker-compose.yaml`
  - `<tmpDir>/sumeru.env.example`
- Each written file's bytes are **identical** to the corresponding source under `packages/server/templates/docker/` (assert via byte/SHA comparison). No placeholder substitution, no trailing-newline mangling — proving the zero-render contract.
- The return value is a `string[]` of length 3 listing exactly those written paths; every returned path exists on disk (`fs.existsSync` true for each). Order is stable across runs.
- If `targetDir` does not exist, `materializeDockerAssets` creates it (recursive `mkdir`) before writing, rather than throwing `ENOENT`.

### Idempotent / re-runnable

- Calling `materializeDockerAssets(tmpDir)` twice does not throw; the second call leaves the three files present and byte-identical (a plain overwrite of unchanged template bytes is acceptable — the result is deterministic).

### Source resolution is install-location-relative

- The resolved template directory is derived from the module's own path, so a test that invokes the **built** `packages/server/dist/index.js` (not the `src`) from an unrelated working directory still finds the templates. A regression test changes `process.cwd()` to an unrelated dir before calling and still succeeds — proving the function does not depend on `cwd`.

### compose validity + path basis (Docker-gated)

- Guarded by `SUMERU_DOCKER_INTEGRATION=1`; skipped (not failed) when Docker/Compose is unavailable:
  - `docker compose -f <tmpDir>/docker-compose.yaml config` exits `0` (the emitted compose file is syntactically valid and fully interpolatable with defaults).
  - In the parsed `config` output, the bind-mount **source** paths resolve **relative to `tmpDir`** (the compose file's own directory, Compose v2 semantics) — e.g. the `${WORKSPACE:-.}` mount and the `${SUMERU_CONFIG:-./sumeru.yaml}` mount have `source` under `tmpDir`, with **no** v1-vs-v2 path misalignment.
  - The named volume `sumeru-ocas` appears in the parsed config's top-level volumes (and gains the project prefix when `-p <name>` is supplied).

### Public surface + gates

- `materializeDockerAssets` is listed among `@sumeru/server`'s named exports in `packages/server/src/index.ts`; importing it from the package entrypoint type-checks and resolves at runtime.
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. New code uses no `class`, no `interface`, no default exports, no optional `?:` properties; file name is kebab-case (`docker-assets.ts`).
- A changeset under `.changeset/` bumps `@sumeru/server` **minor** (the new export + shipped templates). Combined with `deploy-config-block.md`'s `@sumeru/cli` minor bump, the issue's CI requirement of "@sumeru/server minor + @sumeru/cli minor" is satisfied.

## Non-goals

- **No** `docker compose up` / build / launch invocation — `materializeDockerAssets` only emits files (Phase 2 wires it into `sumeru start`).
- **No** string rendering / templating — byte-for-byte copy only; all variability is compose-native `${VAR:-default}`.
- **No** overwrite-protection policy for user-edited files (the "reuse, don't clobber user changes" CLI nuance is a Phase-2 concern at the call site, not this primitive).
- **No** end-to-end API-parity tests (Phase 3).
