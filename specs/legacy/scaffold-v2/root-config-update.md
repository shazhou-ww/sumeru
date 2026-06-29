---
scenario: "Root workspace, TypeScript, Biome, and proman config files are updated to reference only the four new v2 packages and exclude legacy/, so a clean checkout builds and checks green"
feature: root-config-update
tags: [scaffold, workspace, tsconfig, biome, proman, monorepo, m1-1, issue-122, phase-v2]
---

## Given
- The branch `fix/122-scaffold-legacy` has the v1 packages relocated to `legacy/` and the four new v2 packages scaffolded under `packages/` (see `legacy-migration.md`, `new-packages-skeleton.md`).
- The root config files to reconcile are `pnpm-workspace.yaml`, `tsconfig.json`, `biome.json`, and `proman.yaml`.
- The issue requires that `proman` release configuration is **preserved** (the `release:` block in `proman.yaml` must survive), only the per-package list changes.

## When
- The contributor reads and updates the four root config files, then runs from the repo root:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`

## Then
- **`pnpm-workspace.yaml`**:
  - Its `packages` glob/list resolves the four new packages and **nothing** under `legacy/`. The simplest valid form keeps the `packages/*` glob (which already excludes `legacy/*`); if any explicit list is used it contains only the four new packages.
  - The existing `onlyBuiltDependencies` (`esbuild`, `@biomejs/biome`) and `minimumReleaseAge` keys are retained.
- **Root `tsconfig.json`**:
  - The `references` array lists exactly the four new packages, in dependency order:
    ```json
    "references": [
      { "path": "packages/core" },
      { "path": "packages/adapter-core" },
      { "path": "packages/adapter-claude-code" },
      { "path": "packages/host" }
    ]
    ```
  - It contains **no** reference to any removed v1 package (`server`, `cli`, `adapter-codex`, `adapter-cursor-agent`, `adapter-hermes`) and **no** `legacy/...` path.
  - `compilerOptions` are otherwise unchanged (strict mode, `NodeNext`, `ES2022`, `composite`-compatible settings preserved).
- **`biome.json`**:
  - The `files.includes` globs match the new packages' sources (`packages/*/src/**/*.ts`, `packages/*/tests/**/*.ts`) and do **not** match anything under `legacy/` — so `pnpm run check` never lints frozen v1 code. If `legacy/` would be caught by an existing glob, it is explicitly excluded (e.g. an `!legacy/**` negation or by keeping the `packages/*`-scoped include).
  - Formatter/linter settings (tab indent, recommended rules, organizeImports) are preserved.
- **`proman.yaml`**:
  - The `packages:` list enumerates exactly the four new packages with correct `path` and `type`:
    `@sumeru/core` (lib), `@sumeru/adapter-core` (lib), `@sumeru/adapter-claude-code` (lib), `@sumeru/host` (lib — or `service` if it ships a server entrypoint), each at its `packages/...` path.
  - No entry points at a `legacy/...` path or a removed v1 package.
  - The `release:` block (registry, access, gitTagPrefix) is **unchanged** — proman publish config is preserved per the issue.
- After the edits, a clean run is fully green (issue acceptance):
  - `pnpm install` — no errors.
  - `pnpm run build` — all four packages compile.
  - `pnpm run check` — Biome reports no errors and lints only the new `packages/*`, not `legacy/`.
- `git grep -n "legacy/" -- pnpm-workspace.yaml tsconfig.json biome.json proman.yaml` returns no line that *adds* `legacy/` to a build/lint/publish surface (any mention is an explicit exclusion only).
