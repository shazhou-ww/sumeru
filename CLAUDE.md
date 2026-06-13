# CLAUDE.md — Sumeru

Agent behavior observation lab — run scenes, record turns, analyze UX.

## Project Structure

Monorepo with packages under `packages/`:

| Package | Directory | Description |
|---------|-----------|-------------|
| `@sumeru/core` | `packages/core` | Type definitions (Scene, Turn, Recording) |
| `@sumeru/cli` | `packages/cli` | CLI tool (`sumeru run`, `sumeru list`) |

## Tech Stack

- **Runtime:** Node.js 22
- **Language:** TypeScript (strict mode)
- **Build:** `tsc` (composite project references)
- **Test:** Vitest
- **Package Manager:** pnpm (workspace)
- **Lint/Format:** Biome
- **Publish:** @shazhou/proman

## Commands

```bash
pnpm run build     # Build all packages (tsc via proman)
pnpm run test      # Run all tests (vitest)
pnpm run check     # Biome lint
pnpm run format    # Biome format (auto-fix)
pnpm run typecheck # tsc --build (no emit)
```

## Code Conventions

### TypeScript

- **Strict mode** — no `any`, no unchecked index access
- **`type` over `interface`** — all type definitions use `type`
- **`function` over `class`** — pure functions + closures, no class
- **Named exports only** — no default exports
- **Import paths** — use `.js` extension (ESM convention)

### Naming

| Type | Style | Example |
|------|-------|---------|
| Files | kebab-case | `run-config.ts` |
| Types | PascalCase | `Recording`, `Turn` |
| Functions/variables | camelCase | `parseScene`, `runScene` |
| Constants | UPPER_SNAKE | `DEFAULT_TIMEOUT` |

### Folder Module Discipline

- Every folder exports via `index.ts`
- Types live in `types.ts`
- `index.ts` is pure re-exports only

### No Optional Properties

Use `T | null` instead of `?:`:

```typescript
// ✅ Good
type Scene = { knowledge: Knowledge | null };

// ❌ Bad
type Scene = { knowledge?: Knowledge };
```

## Scenes

Scene definitions live in `scenes/`. Each scene is a directory:

```
scenes/<name>/
  scene.yaml    # Scene definition (agent-agnostic)
  home/         # Mounted as $HOME in container
```

Scenes are agent-agnostic — they define tools, knowledge, and task.
Runner, model, timeout are runtime config, not part of the scene.

## Git

- Commit format: `type: description` (conventional commits)
- Reference issues: `Fixes #N` / `Closes #N`
- Author: `小橘 <xiaoju@shazhou.work>`

## Before Submitting

1. `pnpm run build` — builds cleanly
2. `pnpm run check` — no lint errors
3. `pnpm run test` — all tests pass

## Release Process

Uses `@shazhou/proman`. Add changesets in `.changeset/`:

```markdown
---
"@sumeru/core": minor
---

Description of the change
```

Then: `proman bump` → `proman publish`.
