---
scenario: "Four new v2 packages (core, adapter-core, adapter-claude-code, host) are scaffolded under packages/ at version 0.1.0, each building, linting, and type-checking cleanly as a workspace member"
feature: new-packages-skeleton
tags: [scaffold, package, build, workspace, monorepo, m1-1, issue-122, phase-v2]
---

## Given
- The branch `fix/122-scaffold-legacy` has already relocated all v1 packages to `legacy/` (see `legacy-migration.md`), so `packages/` starts empty of v1 directories.
- Node.js 22 and pnpm 10.x are available on PATH.
- The [package-design wiki](https://git.shazhou.work/shazhou/sumeru/wiki/package-design) defines the v2 package map; the [development-plan wiki](https://git.shazhou.work/shazhou/sumeru/wiki/development-plan) M1 scope requires `@sumeru/core`, `@sumeru/adapter-core`, `@sumeru/adapter-claude-code`, and `@sumeru/host`.
- Exactly four new directories are created under `packages/`, each a workspace member named per the wiki:
  | Directory | Package name | Depends on (workspace) |
  |-----------|--------------|------------------------|
  | `packages/core` | `@sumeru/core` | (none — zero runtime deps) |
  | `packages/adapter-core` | `@sumeru/adapter-core` | `@sumeru/core` |
  | `packages/adapter-claude-code` | `@sumeru/adapter-claude-code` | `@sumeru/core`, `@sumeru/adapter-core` |
  | `packages/host` | `@sumeru/host` | `@sumeru/core` |
- Each new package directory contains at minimum:
  - `package.json` with `"version": "0.1.0"` (fresh start per the issue), `"type": "module"`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, an `exports` map shaped identically to the legacy `@sumeru/core` package.json, a `files: ["dist"]` array, a `"license": "MIT"`, a `"test:ci"` script running `npx vitest run`, and `@sumeru/*` deps declared as `workspace:*` where the table above requires them.
  - `tsconfig.json` extending the root `tsconfig.json` with `compilerOptions.outDir = "dist"`, `rootDir = "src"`, `composite: true`, an `include: ["src"]`, and a `references` array listing each workspace dependency from the table (e.g. `adapter-claude-code` references `[{ "path": "../core" }, { "path": "../adapter-core" }]`).
  - `src/index.ts` — a non-empty module with **at least one named export** (an empty file is not acceptable; a placeholder such as `export const VERSION = "0.1.0";` or a re-export of a `types.ts` is fine). No default export.

## When
- The contributor runs from the repo root, in order:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`
  4. `pnpm run typecheck`

## Then
- The issue's directory smoke check passes:
  ```bash
  ls packages/core packages/adapter-core packages/adapter-claude-code packages/host
  ```
  exits 0 and each directory exists with the files above.
- `pnpm install` exits 0 and resolves all four as workspace packages; `pnpm ls -r --depth -1` shows `@sumeru/core@0.1.0`, `@sumeru/adapter-core@0.1.0`, `@sumeru/adapter-claude-code@0.1.0`, and `@sumeru/host@0.1.0` — each at its `packages/...` path, and **none** at a `legacy/...` path.
- `pnpm run build` exits 0 and produces, for every one of the four packages, `packages/<name>/dist/index.js` and `packages/<name>/dist/index.d.ts` — "全部编译通过（即使只有空 index.ts）" per the issue (compiles even though the modules are placeholders).
- `pnpm run typecheck` (`tsc --build`) exits 0 with the four new project references resolving in dependency order (`core` before `adapter-core`/`host`; `core` + `adapter-core` before `adapter-claude-code`).
- `pnpm run check` exits 0 — Biome reports no lint errors; each package obeys project conventions: no `class`, no `interface`, no default exports, no optional `?:` on type definitions, kebab-case file names, `index.ts` is pure re-exports when a `types.ts` exists, and imports use `.js` extensions.
- Each `package.json` declares version `0.1.0` (not inherited from the legacy `0.2.0` packages).
- A `.changeset/<slug>.md` is present declaring each new publishable package (`@sumeru/core`, `@sumeru/adapter-core`, `@sumeru/adapter-claude-code`, `@sumeru/host`) at a `minor` (`0.1.0` initial surface) bump with a one-line description.
- No directory under `legacy/` is touched, compiled, or linted by any of the four commands.
