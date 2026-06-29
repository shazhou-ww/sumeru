---
scenario: "@sumeru/server package builds, lints, and tests cleanly as a monorepo member"
feature: server
tags: [scaffold, package, build, ci-local]
---

## Given
- The repo `sumeru` is checked out at the issue-#10 branch (`fix/10-server-scaffold`).
- Node.js 22 and pnpm 10.x are available on PATH.
- The monorepo already contains `packages/core` and `packages/cli`.
- `packages/server/` is a new directory with at minimum:
  - `package.json` declaring `"name": "@sumeru/server"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, a `files` array containing `dist`, a `bin` field exposing the server entrypoint (or no `bin` if launched only via `@sumeru/cli`), and a `test:ci` script that runs `npx vitest run`.
  - `tsconfig.json` extending the root `tsconfig.json` with `compilerOptions.outDir = "dist"`, `rootDir = "src"`, `composite: true`, and references to `@sumeru/core` if it imports any types.
  - `src/index.ts` with at least one named export (no default exports).
- The root `tsconfig.json` has `{ "path": "packages/server" }` added to its `references` array.
- The root `proman.yaml` has a new entry under `packages:` with `name: "@sumeru/server"`, `path: packages/server`, `type: lib` (or `service`).

## When
- The contributor runs from the repo root, in order:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`
  4. `pnpm run test`

## Then
- `pnpm install` exits 0 and resolves `@sumeru/server` as a workspace package (visible in `pnpm ls -r --depth -1`).
- `pnpm run build` exits 0 and produces `packages/server/dist/index.js` and `packages/server/dist/index.d.ts`.
- `pnpm run check` exits 0 with no Biome lint errors (no `any`, named exports only, kebab-case file names, `type` over `interface`).
- `pnpm run test` exits 0; the `@sumeru/server` package has at least one passing Vitest spec.
- `packages/server/src/` contains no file that uses `class`, `interface`, default exports, or optional `?:` properties on type definitions.
- Every folder under `packages/server/src/` exports via `index.ts`, with types in `types.ts` and `index.ts` containing only re-exports.
