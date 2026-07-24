# Changelog

## 0.3.0 (2026-07-24)

### ⚠️ Breaking Changes

- **CLI**: All session operations consolidated under `sumeru session` subcommands (#248)
  - Removed: `sumeru chat`, `sumeru exec`, `sumeru reset`, `sumeru snapshot` (top-level)
  - Removed: `sumeru image build`
  - Removed: `sumeru model <session> <model-id>` shortcut
  - New: `sumeru session exec/model/reset/snapshot/turns`
- **Model ID format**: Changed from `provider:name` to globally unique model ID
  - Models are now referenced by their unique ID (e.g. `claude-sonnet-4.5`) instead of `provider:name` format
  - `sumeru model add` now takes model ID as first argument, with `--provider` flag
  - `sumeru prototype add --model` accepts model ID directly
  - Session model override accepts model ID string
- **API**: `POST /sessions/:id/commands` type `"chat"` is deprecated (use `POST /sessions/:id/messages`)
- **Architecture**: Eliminated `@sumeru/sumeru-session` package (#250)
  - Session loop framework moved to `@sumeru/adapter-core`
  - Each adapter owns its own entrypoint (`main.ts`)
  - Docker images use adapter-specific CMD

### Features

- **API**: `POST /sessions` — `task` field is now optional (#249)
  - `task: null` creates session in `idle` state (container ready, no message sent)
  - `task: string` preserves existing behavior (create + auto-run)
- **CLI**: `sumeru session send` — added `--model` and `--env` flags (#246)
- **CLI**: `sumeru session turns <id> [--after N]` — query turn history (#245)
- **CLI**: `sumeru session exec <id> -- <command>` — run shell in container
- **CLI**: `sumeru session model <id> <model-id>` — switch model
- **CLI**: `sumeru session reset <id> [--persona]` — clear context
- **CLI**: `sumeru session snapshot <id> <name>` — docker commit

### Fixes

- **Host**: `defaultAdapterCommand()` handles sarsapa package naming (no `adapter-` prefix)
- **Host**: Search endpoint validates empty `session=` parameter (returns 400)
- **Host**: `VERSION` constant updated to `0.3.0`

### Documentation

- Reorganized `specs/SCENARIOS.md` — API + CLI paired per scenario with spec links
- Added 6 spec files: prototype, extension, commands, search, CLI server, CLI errors
- Added 11 test case files covering commands, extension, prototype, search
- Removed 6 duplicate standalone spec files
- Updated all package READMEs (CLI command tree, host endpoints, new sumeru-session)
- Root README reflects new CLI structure and Docker build commands

### Internal

- Host `VERSION`: `0.1.0` → `0.3.0`
- `CreateSessionBody.model` type accepts string (Model ID) in addition to object
- `SessionInfo.task` type: `string` → `string | null`
- Deleted: `packages/sumeru-session/` (code moved to adapter-core + each adapter)
- Deleted: `packages/cli/src/chat.ts`, `exec.ts`, `reset-cmd.ts`, `snapshot.ts`, `image-build.ts`
- Added pre-push git hook (runs `pnpm run check`)
