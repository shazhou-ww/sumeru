---
scenario: "@sumeru/core exports the M1 minimal type set (20 named types: Manifest/Model, Instance, message-protocol, Host-config) from src/types.ts, re-exported through src/index.ts, building/linting/type-checking cleanly with zero runtime deps"
feature: core-types-minimal-set
tags: [core, types, type-surface, m1-2, issue-123, phase-v2, zero-runtime]
---

## Given
- The branch `fix/123-core-types` is cut from `origin/main`, which already contains the M1-1 scaffold (issue #122, merged PR #134): `packages/core` exists as a `@sumeru/core@0.1.0` workspace member whose `src/index.ts` is the placeholder `export const VERSION = "0.1.0";` and whose `tests/scaffold.test.ts` asserts that `VERSION === "0.1.0"`.
- The [package-design wiki §1 "`@sumeru/core` — 共享类型"](https://git.shazhou.work/shazhou/sumeru/wiki/package-design#1-sumerucore--共享类型) is the **authoritative source** for every type signature below; the [development-plan wiki M1 deliverables](https://git.shazhou.work/shazhou/sumeru/wiki/development-plan) scope `@sumeru/core` to the "最小类型集". The TypeScript block in wiki §1 is reproduced verbatim in the **Then** section — field names, unions, and `| null` shapes must match it character-for-character.
- `@sumeru/core` is a **pure type package with zero runtime dependencies** (per CLAUDE.md and the wiki); the entire deliverable is compile-time `type` declarations plus a re-export barrel — no runtime values, no functions, no classes.
- Project conventions from `CLAUDE.md` that constrain this work:
  - **`type` over `interface`** — every definition uses `type X = …`; `interface` is forbidden.
  - **No optional properties** — use `T | null`, never `?:`.
  - **`type` / PascalCase** for type names, **camelCase** for every property.
  - **Folder Module Discipline** — types live in `types.ts`; `index.ts` is **pure re-exports only**.
  - **Named exports only** — no default export; ESM imports use the `.js` extension.
- The issue requires exactly these **20** named types, grouped as in the issue body:
  - Manifest & Model: `Manifest`, `ModelConfig`, `KnownProvider`, `CustomProvider`
  - Instance: `InstanceId`, `InstanceStatus`, `InstanceInfo`
  - 消息协议: `InboxMessage`, `OutboxFrame`, `TurnValue`, `ToolCall`, `DoneValue`, `SuspendValue`, `ErrorValue`, `TokenUsage`
  - Host 配置: `HostConfig`, `MasterConfig`, `ResourceLimits`

## When
- The contributor adds `packages/core/src/types.ts` containing all 20 type definitions, rewrites `packages/core/src/index.ts` to re-export them, reconciles the scaffold placeholder/test, then runs from the repo root, in order:
  1. `pnpm install`
  2. `pnpm run build`
  3. `pnpm run check`
  4. `pnpm run typecheck`
  5. `pnpm run test`

## Then
- **File layout:** `packages/core/src/types.ts` exists and holds every type definition; `packages/core/src/index.ts` contains **only** re-exports (e.g. `export type * from "./types.js";` or an explicit `export type { Manifest, … } from "./types.js";`) — no type *definitions* live in `index.ts`. The placeholder `export const VERSION = "0.1.0";` is removed from `index.ts` (it was explicitly a scaffold placeholder "until the real type surface lands"; this issue is that landing).
- **Exact type surface** — `types.ts` defines, structurally identical to wiki §1:
  ```typescript
  // === Manifest & Model ===
  type Manifest = {
    name: string
    model: ModelConfig
    instructions: string
    skills: Array<string>
  }
  type ModelConfig = {
    provider: KnownProvider | CustomProvider
    name: string
    apiKeyEnv: string
    contextWindow: number
  }
  type KnownProvider = 'anthropic' | 'openai' | 'openrouter'
  type CustomProvider = {
    baseUrl: string
    apiType: 'openai' | 'anthropic'
  }

  // === Instance ===
  type InstanceId = string  // inst_<ULID>, master 固定 inst_0
  type InstanceStatus = 'running' | 'stopped' | 'idle' | 'suspended'
  type InstanceInfo = {
    id: InstanceId
    prototype: string | null   // null = master
    status: InstanceStatus
    createdAt: string          // ISO timestamp
    projects: Array<string>
  }

  // === 消息协议 (Host <-> Adapter NDJSON 帧) ===
  type InboxMessage = {
    messageId: string
    content: string
    project: string | null
  }
  type OutboxFrame =
    | { type: 'turn'; value: TurnValue }
    | { type: 'done'; value: DoneValue }
    | { type: 'suspend'; value: SuspendValue }
    | { type: 'error'; value: ErrorValue }
  type TurnValue = {
    index: number
    role: 'user' | 'assistant' | 'system'
    content: string
    timestamp: string
    toolCalls: Array<ToolCall> | null
    tokens: TokenUsage | null
  }
  type ToolCall = {
    tool: string
    input: Record<string, unknown>
    output: string | null
    durationMs: number | null
    exitCode: number | null
  }
  type DoneValue = {
    summary: string | null
    tokenUsage: TokenUsage | null
  }
  type SuspendValue = {
    reason: 'timeout' | 'permissionRequest' | 'inputRequired'
    elapsedMs: number
  }
  type ErrorValue = {
    code: string
    message: string
  }
  type TokenUsage = {
    input: number
    output: number
  }

  // === Host 配置 ===
  type HostConfig = {
    name: string
    master: MasterConfig
    resources: ResourceLimits
  }
  type MasterConfig = {
    adapter: string
    config: Record<string, unknown>
  }
  type ResourceLimits = {
    maxMemory: string
    maxCpus: number
    maxInstances: number
  }
  ```
- **Field-name fidelity:** the two distinct token-bearing fields are preserved exactly as the wiki spells them — `TurnValue.tokens` (named `tokens`) and `DoneValue.tokenUsage` (named `tokenUsage`); they are **not** normalized to a common name. `OutboxFrame` is a **discriminated union keyed on `type`** with the four members `turn | done | suspend | error` (covered in depth by `core-message-protocol.md`).
- **Importability:** every one of the 20 names is importable from the package entry, e.g. `import type { Manifest, OutboxFrame, HostConfig } from "@sumeru/core";` type-checks for all 20; no name is missing and no extra public type beyond the 20 is exported (helper/internal aliases, if any, are not re-exported).
- `pnpm run build` exits 0 and produces `packages/core/dist/index.d.ts` declaring all 20 types (a consumer relying on `@sumeru/core` sees them via `dist/index.d.ts`), plus `packages/core/dist/index.js` (which may be effectively empty — `export {};` — because the surface is type-only; that is correct for a zero-runtime type package).
- `pnpm run typecheck` (`tsc --build`, strict mode) exits 0 with **no** `any` and no unchecked-index errors; the composite project reference for `core` resolves before its dependents.
- `pnpm run check` (Biome) exits 0 and the file obeys conventions: **no `interface`**, **no `class`**, **no default export**, **no optional `?:`** anywhere in `types.ts`, kebab-case filename (`types.ts`), and `index.ts` is pure re-exports.
- `pnpm run test` exits 0. The pre-existing `tests/scaffold.test.ts` (which imported `VERSION`) is reconciled so the suite stays green — either replaced or augmented by a `tests/types.test.ts` that, at minimum, **constructs one well-typed literal value for each of the 20 types** (a compile-time conformance check; e.g. assigns a sample `Manifest`, an `OutboxFrame` of each `type` variant, an `InstanceInfo`, a `HostConfig`, etc.) so that any future drift from the wiki signatures fails `tsc`. No remaining test references the removed `VERSION` export.
- `@sumeru/core/package.json` still declares `"version": "0.1.0"` and lists **zero** runtime `dependencies` (the package remains zero-runtime-deps).
- A `.changeset/<slug>.md` is present declaring a `minor` bump for `@sumeru/core` with a one-line description of the added minimal type set (initial public type surface).
- Nothing under `legacy/` is touched, compiled, or linted; no other workspace package's `src/` is modified by this change.
