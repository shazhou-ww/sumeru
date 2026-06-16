# CLAUDE.md — Sumeru

Agent house — 每个节点的 agent 管理层，HTTP 服务，为同一运行环境内的多个 agent 提供统一的收发室，所有交互通过 ocas 全量记录。

## Project Structure

Monorepo with packages under `packages/`:

| Package | Directory | Description |
|---------|-----------|-------------|
| `@sumeru/core` | `packages/core` | Core type definitions (Adapter, Turn, Session types) |
| `@sumeru/server` | `packages/server` | HTTP service (Instance, Gateway, Session management) |
| `@sumeru/adapter-hermes` | `packages/adapter-hermes` | Adapter for Hermes Agent |
| `@sumeru/cli` | `packages/cli` | CLI tool (`sumeru start`) |

## Core Concepts

- **Instance** — 一个 Sumeru 进程 = 一个运行环境的 agent 管理层
- **Gateway** — Instance 内的一个 agent 入口，由 adapter 驱动
- **Session** — 一次 agent 对话，`ses_` + ULID，支持 resume
- **Adapter** — 每类 agent 一个，实现 `createSession` / `send` / `close` / `getTurns`

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
| Types | PascalCase | `Turn`, `Adapter` |
| Functions/variables | camelCase | `createSession`, `startServer` |
| Constants | UPPER_SNAKE | `DEFAULT_TIMEOUT` |

### Folder Module Discipline

- Every folder exports via `index.ts`
- Types live in `types.ts`
- `index.ts` is pure re-exports only

### No Optional Properties

Use `T | null` instead of `?:`:

```typescript
// ✅ Good
type Turn = { tokens: TokenUsage | null };

// ❌ Bad
type Turn = { tokens?: TokenUsage };
```

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
