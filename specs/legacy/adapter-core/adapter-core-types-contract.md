---
scenario: "@sumeru/adapter-core exports the adapter-author contract (AdapterImpl, AdapterInitConfig, SkillContent) and the createAdapterEntry factory, with NDJSON wire-frame types, reusing payload types imported from @sumeru/core"
feature: adapter-core
tags: [adapter-core, types, contract, ndjson, entrypoint, m1-3, issue-124, phase-v2]
---

## Given
- The repo `sumeru` is checked out on branch `fix/124-adapter-core-entrypoint`.
- `@sumeru/core` already exports the M1 minimal type set (issue #123), in particular
  the payload types this package builds on: `InboxMessage`, `TurnValue`, `DoneValue`,
  and `ModelConfig` (see `packages/core/src/types.ts` and `specs/core/`).
- `@sumeru/adapter-core` currently contains only a scaffold placeholder
  (`export const VERSION = "0.1.0"`) in `packages/adapter-core/src/index.ts`, with
  `package.json` declaring `"name": "@sumeru/adapter-core"`, `"type": "module"`,
  `"main": "dist/index.js"`, `dependencies: { "@sumeru/core": "workspace:*" }`, and a
  `tsconfig.json` that `references` `../core`.
- The authoritative design is [package-design wiki §4 "@sumeru/adapter-core — Adapter 公共框架"](https://git.shazhou.work/shazhou/sumeru/wiki/package-design#4-sumeruadapter-core--adapter-公共框架).
- Project conventions (CLAUDE.md): `type` over `interface`, `function` over `class`,
  named exports only, `.js` import extensions (ESM), `| null` instead of optional `?:`,
  kebab-case file names, `src/index.ts` is **pure re-exports only**, types live in
  `src/types.ts`.

## When
- The contributor adds the package-internal type surface to `packages/adapter-core/src/types.ts`
  and re-exports it through `src/index.ts`, then a consumer (or a `tests/` conformance file)
  imports the types and compiles under the repo's strict `tsc`:
  ```typescript
  import type {
    AdapterImpl,
    AdapterInitConfig,
    SkillContent,
  } from "@sumeru/adapter-core";
  import { createAdapterEntry } from "@sumeru/adapter-core";
  import type { InboxMessage, TurnValue, DoneValue, ModelConfig } from "@sumeru/core";
  ```
- The contributor runs `pnpm run build`, `pnpm run check`, and `pnpm run test`.

## Then
- **Adapter-author contract** — `AdapterImpl` is exactly (no `?:`; `type`, not `interface`):
  ```typescript
  type AdapterImpl = {
    init(config: AdapterInitConfig): Promise<void>;
    handle(message: InboxMessage): AsyncGenerator<TurnValue, DoneValue>;
  };
  ```
  - `handle` is an `AsyncGenerator` whose **yield** type is `TurnValue` and whose **return**
    type is `DoneValue` (i.e. `AsyncGenerator<TurnValue, DoneValue>`). The third
    (`TNext`) parameter is left at its default. Assigning an object literal with these two
    methods to `AdapterImpl` type-checks; omitting either method fails `tsc`.
- **Init config** — `AdapterInitConfig` is exactly:
  ```typescript
  type AdapterInitConfig = {
    instructions: string;
    skills: Array<SkillContent>;
    model: ModelConfig;            // imported from @sumeru/core
  };
  ```
  - `model` is the `ModelConfig` type re-used from `@sumeru/core` (NOT redefined locally) —
    a structurally-incompatible local copy is rejected by the conformance test.
  - There is **no** `workdir`/`cwd` field on `AdapterInitConfig` (per wiki §4: HOME is fixed,
    working directory is carried per-message via `InboxMessage.project`).
- **Skill content** — `SkillContent` is exactly `{ name: string; content: string }`.
- **Entrypoint factory** — `createAdapterEntry` is a **named** export with signature
  `(impl: AdapterImpl) => void`. It is a `function` (not a class, not a default export).
- **Wire-frame types** — the package defines the NDJSON envelope types that flow over
  stdin/stdout (names are illustrative; the *shape* is normative):
  - Inbound (read from stdin), a discriminated union on `type`:
    - `{ type: "init"; value: AdapterInitConfig }`
    - `{ type: "message"; value: InboxMessage }`
  - Outbound (written to stdout), a discriminated union on `type`:
    - `{ type: "ready"; value: {} }` — `value` is an empty object (a `Record<string, never>`).
    - `{ type: "turn"; value: TurnValue }`
    - `{ type: "done"; value: DoneValue }`
  - `turn`/`done` reuse `TurnValue`/`DoneValue` from `@sumeru/core`; the outbound `ready`
    frame is local to adapter-core because core's `OutboxFrame` does not include a `ready`
    member. Switching on `frame.type` narrows `frame.value` to the matching payload with no cast.
- **Type-only imports from core** — every payload type used (`InboxMessage`, `TurnValue`,
  `DoneValue`, `ModelConfig`) is imported from `@sumeru/core`, not re-declared. Removing the
  `@sumeru/core` dependency breaks compilation.
- **Conventions hold** — `pnpm run check` (Biome) exits 0: no `interface`, no `class`,
  no default export, no optional `?:` on any of the above types, kebab-case file names,
  `.js` extensions on relative imports, and `src/index.ts` contains **only** re-exports
  (the implementation lives in `src/entrypoint.ts`, types in `src/types.ts`).
- **Build/test green** — `pnpm run build` exits 0 and emits `packages/adapter-core/dist/index.js`
  + `dist/index.d.ts`, whose declared surface includes `createAdapterEntry`, `AdapterImpl`,
  `AdapterInitConfig`, and `SkillContent`. `pnpm run test` exits 0 with at least the
  type-conformance test passing. The new project reference does not break
  `pnpm run typecheck` for `@sumeru/core`, `@sumeru/adapter-claude-code`, or `@sumeru/host`.
