---
scenario: "@sumeru/adapter-claude-code package scaffolds, builds, lints, and tests cleanly as a workspace member, exporting a factory that satisfies the Adapter contract"
feature: adapter-claude-code
tags: [scaffold, package, build, ci-local, adapter, claude-code, phase-3]
---

## Given
- The repo `sumeru` is checked out at the issue-#25 branch (`fix/25-adapter-claude-code`).
- Node.js 22 and pnpm 10.x are available on PATH.
- The monorepo already contains `packages/core`, `packages/server`, `packages/cli`, and `packages/adapter-hermes` (the structural and conventional template for this package).
- The `Adapter` type from `@sumeru/core` is in place (see `specs/adapter-interface.md`) and re-exports `NativeSessionRef`, `AgentResponse`, `AdapterCapabilities`, `Turn`, `TokenUsage`, `ToolCall`.
- `packages/adapter-claude-code/` is a new directory that is the workspace home of `@sumeru/adapter-claude-code` and contains at minimum:
  - `package.json` with `"name": "@sumeru/adapter-claude-code"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, an `exports` map identical in shape to `packages/adapter-hermes/package.json`, a `files: ["dist"]` array, dependency on `@sumeru/core` (via `workspace:*`), a `test:ci` script that runs `npx vitest run`, and a `build` script that runs `tsc -b`.
  - `tsconfig.json` extending the root `tsconfig.json` with `compilerOptions.outDir = "dist"`, `rootDir = "src"`, `composite: true`, and `references: [{ "path": "../core" }]`.
  - `src/index.ts` exporting (named, not default) `createClaudeCodeAdapter` (a factory) and the package-internal types it needs (`ClaudeCodeAdapterOptions`, plus the `SpawnFn`/`SpawnArgs`/`SpawnResult` test seam types if shared).
  - `src/types.ts` for any package-local type definitions.
  - `src/adapter.ts` (factory implementation), `src/spawn.ts` (child_process wrapper), `src/stream-parser.ts` (NDJSON parser).
- The root `tsconfig.json` has `{ "path": "packages/adapter-claude-code" }` added to its `references` array.
- The root `proman.yaml` has a new entry under `packages:` with `name: "@sumeru/adapter-claude-code"`, `path: packages/adapter-claude-code`, `type: lib`.
- The root `pnpm-workspace.yaml` already globs `packages/*`, so no edit is required there.
- `vitest.config.ts` (per-package) mirrors the one in `packages/adapter-hermes/`.

## When
- The contributor runs from the repo root, in order:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`
  4. `pnpm run test`

## Then
- `pnpm install` exits 0 and resolves `@sumeru/adapter-claude-code` as a workspace package (`pnpm ls -r --depth -1` shows it).
- `pnpm run build` exits 0 and produces `packages/adapter-claude-code/dist/index.js` and `packages/adapter-claude-code/dist/index.d.ts`. The `.d.ts` exports `createClaudeCodeAdapter` with the signature `(opts?: Partial<ClaudeCodeAdapterOptions>) => Adapter` (where `Adapter` is imported from `@sumeru/core`).
- `pnpm run check` exits 0 — no Biome lint errors. The package follows project conventions:
  - No `class`, no `interface`, no default exports, no optional `?:` properties on type definitions.
  - File names are kebab-case.
  - `src/index.ts` is **pure re-exports only**; the factory implementation lives in `src/adapter.ts`.
  - Imports use `.js` extensions per ESM convention.
- `pnpm run test` exits 0; the package has at least one passing Vitest spec — at minimum a type-level test that confirms `createClaudeCodeAdapter()` is assignable to `Adapter` from `@sumeru/core`.
- The factory `createClaudeCodeAdapter`:
  - Returns an object with `name: "claude-code"`, `capabilities: { resume: true, streaming: false }` (MVP — `claude --resume <id>` is supported; no live streaming through the adapter — the stream-json output is captured in full and parsed after exit).
  - All four async methods (`createSession`, `send`, `close`, `getTurns`) are **defined** and not stubs that throw `not_implemented` — concrete behavior is specced in `adapter-claude-code-create-session.md`, `adapter-claude-code-send.md`, `adapter-claude-code-close.md`, `adapter-claude-code-get-turns.md`.
- `ClaudeCodeAdapterOptions` (exported type) has at minimum (no `?:` — every field accepts `null` to fall through to the default):
  - `claudeBin: string | null` — path to the `claude` executable; defaults to `"claude"` (rely on `$PATH`).
  - `model: string | null` — `--model` value passed on every spawn; defaults to `null` (do NOT pass `--model`, let CC pick its default).
  - `maxTurns: number | null` — value of `--max-turns`; defaults to `90` (matches uwf reference).
  - `cwd: string | null` — working directory for the spawned process; defaults to `process.cwd()` resolved at call time.
  - `createSessionTimeoutMs: number | null` — default `5 * 60_000` (5 minutes).
  - `sendTimeoutMs: number | null` — default `10 * 60_000` (10 minutes — CC sessions can be longer than Hermes's because of `--max-turns 90`).
  - `spawnFn: SpawnFn | null` — test-only override for `child_process.spawn`. Production code never passes this.
- A `.changeset/<slug>.md` is present declaring `@sumeru/adapter-claude-code` as a `minor` (initial publishable surface) bump with a one-line description.
- Adding the package does NOT break the existing `@sumeru/server`, `@sumeru/adapter-hermes`, or `@sumeru/cli` builds — `pnpm run typecheck` from the root succeeds with the new project reference present.
- The CLI smoke test (`packages/server/tests/server.test.ts` or equivalent) is unaffected by the new package's mere presence (the wiring change is specced separately in `adapter-claude-code-server-integration.md`).
