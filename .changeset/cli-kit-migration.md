---
"@sumeru/cli": minor
---

feat: migrate CLI from commander to @ocas/cli-kit

Migrate the sumeru CLI to use `@ocas/cli-kit` for schema-driven command
building and output validation. This is the fourth project to adopt cli-kit
(after ocas, proman, and gangmu).

Changes:
- `commander` → `createCLI()` builder pattern
- Zod schemas for structured output validation
- Early `--help`/`--version` interception (cli-kit workaround, see ocas#230)
- Per-command `--help` text for `start` and `run`
- Short flag aliases (`-c`) defined as separate flags (cli-kit workaround)
- `start` command bypasses cli-kit output system: uses `process.stdout/stderr`
  directly + `process.exit()` to preserve exact output format for e2e tests
- All existing functionality preserved: `--emit-assets`, docker dispatch,
  PID file lifecycle, port retry, graceful shutdown
- `run` command: `--image`/`-i` flag removed (issue #85), `--no-network`
  added as separate flag (cli-kit workaround)
- Deleted local `packages/cli-kit/` (old 0.1.0 copy, superseded by npm)
- Bumped `@shazhou/proman` devDep to ^0.11.0

Refs: ocas#230 (cli-kit missing features)
