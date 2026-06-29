---
scenario: "@sumeru/adapter-cursor-agent package scaffolds, builds, lints, and tests cleanly as a workspace member, exporting a factory that satisfies the Adapter contract"
feature: adapter-cursor-agent
tags: [scaffold, package, build, ci-local, adapter, cursor-agent]
---

## Given
- The repo `sumeru` is checked out at the issue-#37 branch (`fix/37-adapter-cursor-agent`).
- Node.js 22 and pnpm 10.x are available on PATH.
- The monorepo already contains `packages/core`, `packages/server`, `packages/cli`, `packages/adapter-hermes`, and `packages/adapter-claude-code` (the structural and conventional template for this package).
- The `Adapter` type from `@sumeru/core` is in place and re-exports `NativeSessionRef`, `AgentResponse`, `AdapterCapabilities`, `Turn`, `TokenUsage`, `ToolCall`.
- `packages/adapter-cursor-agent/` is a new directory that is the workspace home of `@sumeru/adapter-cursor-agent` and contains at minimum:
  - `package.json` with `"name": "@sumeru/adapter-cursor-agent"`, `"version": "0.1.0"`, `"type": "module"`, `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, an `exports` map identical in shape to `packages/adapter-claude-code/package.json`, a `files: ["dist"]` array, dependency on `@sumeru/core` (via `workspace:*`), a `test:ci` script that runs `npx vitest run`, and a `build` script that runs `tsc -b`.
  - `tsconfig.json` extending the root `tsconfig.json` with `compilerOptions.outDir = "dist"`, `rootDir = "src"`, `composite: true`, and `references: [{ "path": "../core" }]`.
  - `src/index.ts` exporting (named, not default) `createCursorAgentAdapter` (a factory) and the package-internal types it needs (`CursorAgentAdapterOptions`, plus the `SpawnFn`/`SpawnArgs`/`SpawnResult` test seam types).
  - `src/types.ts` for package-local type definitions.
  - `src/adapter.ts` (factory implementation), `src/spawn.ts` (child_process wrapper), `src/stream-parser.ts` (NDJSON parser).
- The root `tsconfig.json` has `{ "path": "packages/adapter-cursor-agent" }` added to its `references` array.
- The root `proman.yaml` has a new entry under `packages:` with `name: "@sumeru/adapter-cursor-agent"`, `path: packages/adapter-cursor-agent`, `type: lib`.
- The root `pnpm-workspace.yaml` already globs `packages/*`, so no edit is required there.
- `vitest.config.ts` (per-package) mirrors the one in `packages/adapter-claude-code/`.

## When
- The contributor runs from the repo root, in order:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`
  4. `pnpm run test`

## Then
- `pnpm install` exits 0 and resolves `@sumeru/adapter-cursor-agent` as a workspace package (`pnpm ls -r --depth -1` shows it).
- `pnpm run build` exits 0 and produces `packages/adapter-cursor-agent/dist/index.js` and `packages/adapter-cursor-agent/dist/index.d.ts`. The `.d.ts` exports `createCursorAgentAdapter` with the signature `(opts?: Partial<CursorAgentAdapterOptions>) => Adapter` (where `Adapter` is imported from `@sumeru/core`).
- `pnpm run check` exits 0 — no Biome lint errors. The package follows project conventions:
  - No `class`, no `interface`, no default exports, no optional `?:` properties on type definitions.
  - File names are kebab-case.
  - `src/index.ts` is **pure re-exports only**; the factory implementation lives in `src/adapter.ts`.
  - Imports use `.js` extensions per ESM convention.
- `pnpm run test` exits 0; the package has at least one passing Vitest spec — at minimum a type-level test that confirms `createCursorAgentAdapter()` is assignable to `Adapter` from `@sumeru/core`.
- The factory `createCursorAgentAdapter`:
  - Returns an object with `name: "cursor-agent"`, `capabilities: { resume: true, streaming: false }` (MVP — `cursor-agent --resume <id>` is supported; no live streaming through the adapter — the stream-json output is captured in full and parsed after exit).
  - All four async methods (`createSession`, `send`, `close`, `getTurns`) are **defined** and not stubs that throw `not_implemented` — concrete behavior is specced in sibling spec files.
- `CursorAgentAdapterOptions` (exported type) has at minimum (no `?:` — every field accepts `null` to fall through to the default):
  - `cursorAgentBin: string | null` — path to the `cursor-agent` executable; defaults to `"cursor-agent"` (rely on `$PATH`).
  - `model: string | null` — `--model` value passed on every spawn; defaults to `null` (do NOT pass `--model`, let cursor-agent pick its default).
  - `cwd: string | null` — working directory for the spawned process; defaults to `process.cwd()` resolved at call time. Passed as `--workspace <path>`.
  - `createSessionTimeoutMs: number | null` — default `5 * 60_000` (5 minutes).
  - `sendTimeoutMs: number | null` — default `10 * 60_000` (10 minutes).
  - `spawnFn: SpawnFn | null` — test-only override for `child_process.spawn`. Production code never passes this.
  - `permissionMode: "force" | "yolo" | null` — controls permission bypass flag. `"force"` passes `--force`, `"yolo"` passes `--yolo`. Defaults to `"force"`.
  - `sandbox: "enabled" | "disabled" | null` — `--sandbox` value; defaults to `null` (do not pass flag).
- A `.changeset/<slug>.md` is present declaring `@sumeru/adapter-cursor-agent` as a `minor` (initial publishable surface) bump with a one-line description.
- Adding the package does NOT break the existing `@sumeru/server`, `@sumeru/adapter-hermes`, `@sumeru/adapter-claude-code`, or `@sumeru/cli` builds — `pnpm run typecheck` from the root succeeds with the new project reference present.
