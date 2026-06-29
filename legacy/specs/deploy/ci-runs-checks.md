---
scenario: "Gitea Actions CI runs build, lint, and tests on push and PR"
feature: ci
tags: [ci, gitea-actions, build, lint, test]
---

## Given
- `.gitea/workflows/ci.yml` exists at the repo root and was already wired in a previous phase.
- The new `@sumeru/server` package adds at least one Vitest spec and contributes to `pnpm run build` / `pnpm run check` / `pnpm run test:ci`.
- `package.json` at the repo root defines:
  - `"build": "proman build"`
  - `"check": "proman check"`
  - `"test": "proman test"`
  - `"test:ci": "pnpm -r run test:ci"`
- `@sumeru/server`'s `package.json` includes `"test:ci": "npx vitest run"` (matching `core` and `cli`).

## When
- A contributor pushes a commit on branch `fix/10-server-scaffold`, or opens a PR targeting `main`.

## Then
- The `CI` workflow triggers (visible in `tea actions list -r shazhou/sumeru` or in the Gitea UI under Actions).
- The single `check` job runs on `ubuntu-latest`, sets up Node.js 22, enables corepack, and runs `pnpm install` followed by:
  1. `pnpm run build`
  2. `pnpm run check`
  3. `pnpm run test:ci`
- All three steps exit 0 — including the `@sumeru/server` slice (its tsc build, its Biome check, its Vitest run).
- The `test:ci` step recurses into every package via `pnpm -r run test:ci`, so adding `@sumeru/server`'s `test:ci` script is sufficient — no edit to `.gitea/workflows/ci.yml` is required unless a step name changes.
- Workflow run finishes with status `success`. The PR's check status badge is green.
- If any of `build`, `check`, or `test:ci` fails locally, the same failure reproduces in CI on the same commit (no env-specific drift).
