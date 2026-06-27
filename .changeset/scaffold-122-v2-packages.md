---
"@sumeru/core": minor
"@sumeru/adapter-core": minor
"@sumeru/adapter-claude-code": minor
"@sumeru/host": minor
---

feat: scaffold v2 package structure and freeze v1 under legacy/ (M1-1, #122)

Relocate the seven v1 packages (`core`, `server`, `adapter-hermes`,
`adapter-claude-code`, `adapter-cursor-agent`, `adapter-codex`, `cli`) to a
frozen `legacy/` tree via `git mv` (history preserved), and stand up the four
fresh v2 packages under `packages/` at version `0.1.0`:

- `@sumeru/core` — shared type definitions (zero runtime deps)
- `@sumeru/adapter-core` — adapter common framework (cli-kit NDJSON entrypoint)
- `@sumeru/adapter-claude-code` — Claude Code adapter
- `@sumeru/host` — host HTTP service + Transport layer

Each new package builds, type-checks, and lints clean with a placeholder
module. Root config (`pnpm-workspace.yaml`, `tsconfig.json`, `biome.json`,
`proman.yaml`) and docs (`CLAUDE.md`, `README.md`) now reference only the four
active v2 packages; `legacy/` is excluded from the workspace, build, lint, and
publish. The proman `release:` block is preserved unchanged.

Refs: #122
