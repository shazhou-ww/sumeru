---
scenario: "@sumeru/adapter-hermes package scaffolds, builds, lints, and tests cleanly as a workspace member, exporting a factory that satisfies the Adapter contract"
feature: adapter-hermes
tags: [scaffold, package, build, ci-local, adapter, hermes, phase-3]
---

## Given
- The repo `sumeru` is checked out at the issue-#13 branch (`fix/13-hermes-adapter-sse`).
- Node.js 22 and pnpm 10.x are available on PATH.
- The monorepo already contains `packages/core`, `packages/server`, and `packages/cli`.
- The `Adapter` type from `@sumeru/core` is in place (see `specs/adapter-interface.md`).
- `packages/adapter-hermes/` is a new directory that is the workspace home of `@sumeru/adapter-hermes` and contains at minimum:
  - `package.json` with `"name": "@sumeru/adapter-hermes"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, a `files: ["dist"]` array, dependency on `@sumeru/core` (via `workspace:*`), a `test:ci` script that runs `npx vitest run`, and a `build` script that runs `tsc -b`.
  - `tsconfig.json` extending the root `tsconfig.json` with `compilerOptions.outDir = "dist"`, `rootDir = "src"`, `composite: true`, and a `references` array including `{ "path": "../core" }`.
  - `src/index.ts` exporting (named, not default) `createHermesAdapter` (a factory) and the package-internal types it needs.
  - `src/types.ts` for any package-local type definitions.
- The root `tsconfig.json` has `{ "path": "packages/adapter-hermes" }` added to its `references` array.
- The root `proman.yaml` has a new entry under `packages:` with `name: "@sumeru/adapter-hermes"`, `path: packages/adapter-hermes`, `type: lib`.
- The root `pnpm-workspace.yaml` already globs `packages/*`, so no edit is required there.

## When
- The contributor runs from the repo root, in order:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`
  4. `pnpm run test`

## Then
- `pnpm install` exits 0 and resolves `@sumeru/adapter-hermes` as a workspace package (`pnpm ls -r --depth -1` shows it).
- `pnpm run build` exits 0 and produces `packages/adapter-hermes/dist/index.js` and `packages/adapter-hermes/dist/index.d.ts`. The `.d.ts` exports `createHermesAdapter` with the signature `(opts?: HermesAdapterOptions) => Adapter` (where `Adapter` is imported from `@sumeru/core`).
- `pnpm run check` exits 0 — no Biome lint errors. The package follows project conventions:
  - No `class`, no `interface`, no default exports, no optional `?:` properties on type definitions.
  - File names are kebab-case.
  - `src/index.ts` is **pure re-exports only**; the factory implementation lives in another file (e.g. `src/adapter.ts`) or a folder (e.g. `src/adapter/index.ts`).
- `pnpm run test` exits 0; the package has at least one passing Vitest spec — at minimum a type-level test that confirms `createHermesAdapter()` is assignable to `Adapter` from `@sumeru/core`.
- The factory `createHermesAdapter`:
  - Returns an object with `name: "hermes"`, `capabilities: { resume: true, streaming: false }` (MVP — see issue's "MVP 不需要 streaming adapter"; resume is supported because `hermes chat -q --resume <id>` works).
  - All four async methods (`createSession`, `send`, `close`, `getTurns`) are **defined** (not stubs that throw `not_implemented`) — concrete behavior is specced in `adapter-hermes-create-session.md`, `adapter-hermes-send.md`, `adapter-hermes-close.md`, `adapter-hermes-get-turns.md`.
- `HermesAdapterOptions` (exported type) has at minimum:
  - `hermesBin: string | null` — path to the `hermes` executable; defaults to `"hermes"` (rely on `$PATH`) when null/absent.
  - `sourceTag: string | null` — `--source` value used when invoking `hermes chat`; defaults to `"sumeru"` so adapter-created sessions don't pollute `hermes sessions list --source cli`.
- A `.changeset/<slug>.md` is present declaring `@sumeru/adapter-hermes` as a `minor` (initial publishable surface) bump.
- Adding the package does NOT break the existing `@sumeru/server` build — `pnpm run typecheck` from the root succeeds with the new project reference present.
- The CLI smoke test (`packages/server/tests/server.test.ts` or equivalent) is unaffected.
