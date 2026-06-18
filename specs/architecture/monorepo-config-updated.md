---
scenario: "Workspace config and CLAUDE.md reflect the new @sumeru/server package"
feature: monorepo-config
tags: [workspace, claude-md, docs, scaffold]
---

## Given
- The branch `fix/10-server-scaffold` contains the new `packages/server/` directory.
- `pnpm-workspace.yaml` already uses the glob `packages/*` (so no edit there is required if and only if the glob still matches; if `packages` is hard-listed elsewhere, those lists must include the new package).
- `proman.yaml` enumerates packages explicitly.

## When
- The contributor reads:
  - `pnpm-workspace.yaml`
  - `proman.yaml`
  - `CLAUDE.md`
  - The root `tsconfig.json`
- And runs `pnpm ls -r --depth -1 --json` from the repo root.

## Then
- `pnpm-workspace.yaml`'s `packages` list (or glob) resolves `@sumeru/server`. Output of `pnpm ls -r --depth -1` includes a line for `@sumeru/server@0.1.0` at `packages/server`.
- `proman.yaml` has an entry with `name: "@sumeru/server"` and `path: packages/server`.
- The root `tsconfig.json` `references` array contains `{ "path": "packages/server" }` so `tsc --build` walks into the new package.
- `CLAUDE.md`'s "Project Structure" table has a new row:
  ```
  | `@sumeru/server` | `packages/server` | HTTP service (instance endpoint, gateways, sessions) |
  ```
  …and the row order matches the build dependency order (`core` before `server`, `server` before `cli`, since `cli` depends on `server` for `sumeru start`).
- `CLAUDE.md` does **not** introduce any new code conventions — the existing rules (`type` over `interface`, named exports only, `T | null` instead of `?:`, kebab-case file names, folder-module discipline) still apply to `packages/server/src/`.
- `README.md` (if it lists packages) is updated in the same way, or left untouched if it does not list packages.
