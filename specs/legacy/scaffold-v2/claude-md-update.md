---
scenario: "CLAUDE.md (and README package listing) is updated to describe the v2 package structure and the frozen legacy/ tree, with no v1 packages presented as active"
feature: claude-md-update
tags: [scaffold, docs, claude-md, readme, conventions, m1-1, issue-122, phase-v2]
---

## Given
- The branch `fix/122-scaffold-legacy` has completed the migration and scaffold (see `legacy-migration.md`, `new-packages-skeleton.md`, `root-config-update.md`).
- `CLAUDE.md`'s current "Project Structure" table lists the seven v1 packages (`@sumeru/core`, `@sumeru/server`, `@sumeru/adapter-hermes`, `@sumeru/adapter-claude-code`, `@sumeru/adapter-cursor-agent`, `@sumeru/adapter-codex`, `@sumeru/cli`) — all of which now live under `legacy/`.
- The issue explicitly calls out that `CLAUDE.md` needs updating to reflect the new structure, while existing code conventions stay in force.
- The [package-design wiki](https://git.shazhou.work/shazhou/sumeru/wiki/package-design) is the source of truth for each new package's responsibility.

## When
- The contributor reads and updates `CLAUDE.md` (and `README.md` if it enumerates packages), then re-reads them.

## Then
- `CLAUDE.md`'s "Project Structure" table lists **only** the four active v2 packages, in build-dependency order, with descriptions drawn from the package-design wiki:
  | Package | Directory | Description |
  |---------|-----------|-------------|
  | `@sumeru/core` | `packages/core` | Shared type definitions (zero runtime deps) |
  | `@sumeru/adapter-core` | `packages/adapter-core` | Adapter common framework (cli-kit NDJSON entrypoint) |
  | `@sumeru/adapter-claude-code` | `packages/adapter-claude-code` | Claude Code adapter |
  | `@sumeru/host` | `packages/host` | Host HTTP service + Transport layer |
  (Exact wording may vary, but each new package appears with its correct `packages/...` path and a description consistent with the wiki.)
- `CLAUDE.md` documents that the previous v1 implementation is frozen under `legacy/` and is **not** part of the build (a short note stating `legacy/` is excluded from the workspace/build/lint), so a future contributor does not mistake it for active code.
- No removed v1 package (`@sumeru/server`, `@sumeru/cli`, `@sumeru/adapter-hermes`, `@sumeru/adapter-cursor-agent`, `@sumeru/adapter-codex`) is presented in `CLAUDE.md` as an active `packages/...` member.
- The existing **Code Conventions** sections are preserved verbatim in spirit — `type` over `interface`, `function` over `class`, named exports only, `T | null` instead of `?:`, kebab-case file names, folder-module discipline, `.js` ESM import paths — the issue introduces no new conventions, only structural updates.
- The **Commands** section still lists `pnpm run build` / `test` / `check` / `format` / `typecheck` and they remain accurate against the new four-package workspace.
- If `README.md` contains a package listing or architecture diagram, it is updated the same way (four active packages; legacy noted as frozen) or left untouched if it lists no packages.
- A documentation review passes: `git grep -n "@sumeru/server\|@sumeru/cli\|adapter-hermes\|adapter-cursor-agent\|adapter-codex" CLAUDE.md README.md` returns no line that describes those packages as a current/active `packages/...` member (mentions are only historical/legacy context, if any).
