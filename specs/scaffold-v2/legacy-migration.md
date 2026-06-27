---
scenario: "All existing packages/* are relocated to legacy/ with git history preserved and removed from the build, leaving the workspace empty of v1 packages"
feature: legacy-migration
tags: [scaffold, migration, legacy, workspace, monorepo, m1-1, issue-122, phase-v2]
---

## Given
- The repo `sumeru` is checked out on branch `fix/122-scaffold-legacy` (worktree off `origin/main`).
- Node.js 22 and pnpm 10.x are available on PATH.
- Before any change, `packages/` contains exactly these seven v1 packages:
  `adapter-claude-code`, `adapter-codex`, `adapter-cursor-agent`, `adapter-hermes`, `cli`, `core`, `server`.
- `pnpm-workspace.yaml` currently globs `packages/*`, so all seven are workspace members.
- `proman.yaml` currently enumerates all seven under `packages:` and carries a `release:` block.
- The migration is driven by [issue #122](https://git.shazhou.work/shazhou/sumeru/issues/122) and the
  [package-design wiki](https://git.shazhou.work/shazhou/sumeru/wiki/package-design): the v1 code is frozen, not deleted.

## When
- The contributor moves every directory under `packages/` to a new top-level `legacy/` directory **using `git mv`** (one rename per package, preserving the subdirectory name), e.g.:
  ```bash
  mkdir -p legacy
  git mv packages/core legacy/core
  git mv packages/server legacy/server
  git mv packages/adapter-hermes legacy/adapter-hermes
  git mv packages/adapter-claude-code legacy/adapter-claude-code
  git mv packages/adapter-codex legacy/adapter-codex
  git mv packages/adapter-cursor-agent legacy/adapter-cursor-agent
  git mv packages/cli legacy/cli
  ```
- And removes the v1 packages from the build surface so nothing under `legacy/` is compiled, linted, tested, or published.

## Then
- `legacy/` exists and contains all seven former packages with their original subdirectory names. In particular the issue's smoke check passes:
  ```bash
  ls legacy/core legacy/server legacy/adapter-hermes
  ```
  exits 0 and lists each directory's contents (`package.json`, `src/`, etc.).
- The full set is present: `ls legacy/` shows `adapter-claude-code adapter-codex adapter-cursor-agent adapter-hermes cli core server`.
- **Git history is preserved**: `git log --follow -- legacy/core/package.json` shows commits made before the move (the pre-migration history of the old `packages/core/package.json`), and `git status` reports the moves as renames (`R  packages/core/... -> legacy/core/...`) rather than delete+add.
- `legacy/` does **not** participate in the build:
  - `pnpm-workspace.yaml`'s `packages` globs/lists do **not** match anything under `legacy/` (the `packages/*` glob naturally excludes `legacy/*`, and no `legacy/*` entry is added).
  - `pnpm install` followed by `pnpm ls -r --depth -1` lists **no** package whose path is under `legacy/`.
  - `proman.yaml`'s `packages:` list contains **no** entry pointing at a `legacy/...` path.
  - The root `tsconfig.json` `references` array contains **no** `{ "path": "legacy/..." }` entry, so `tsc --build` never walks into `legacy/`.
- After the move, `packages/` contains **only** the new v2 skeleton (specified in `new-packages-skeleton.md`) — none of the seven v1 directories remain under `packages/`.
- No source file is edited as part of the move itself — the relocation is a pure rename; any content changes (e.g. fixing internal `workspace:*` refs) are out of scope because `legacy/` is no longer built.
