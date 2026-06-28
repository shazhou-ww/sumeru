---
scenario: "@sumeru/core exports a typed Adapter contract (createSession / send / close / getTurns / capabilities) that every agent adapter implements"
feature: core-adapter
tags: [core, adapter, types, contract, phase-3]
---

## Given
- `@sumeru/core` already exports `Turn` and related types (see `packages/core/src/types.ts`).
- Phase 3 introduces a new abstraction — the `Adapter` — which sits between `@sumeru/server` and a concrete agent CLI/SDK (Hermes, Claude Code, etc.).
- Every adapter package (`@sumeru/adapter-hermes`, future `@sumeru/adapter-claude-code`, …) imports the `Adapter` type from `@sumeru/core` and exports a factory function returning an object that satisfies it.
- The architecture spec (`specs/architecture.md`, lines 67–82) is the source of truth for the shape; this spec turns it into compilable TypeScript.

## When
- The contributor adds the following to `packages/core/src/types.ts` (or a new `packages/core/src/adapter.ts` re-exported via `index.ts`):
  ```typescript
  export type NativeSessionRef = {
    /** Stable identifier used by the agent's own tooling (e.g. Hermes session ID). */
    nativeId: string;
    /** Adapter-specific opaque metadata (e.g. cwd, source tag, model). */
    meta: Record<string, unknown>;
  };

  export type AgentResponse = {
    /** Turns produced by the agent during this `send` call, in order. */
    turns: Turn[];
    /** Aggregated token usage for the call, or null if the adapter cannot report it. */
    tokens: TokenUsage | null;
    /** Wall-clock duration of the call in milliseconds. */
    durationMs: number;
  };

  export type AdapterCapabilities = {
    resume: boolean;
    streaming: boolean;
  };

  export type Adapter = {
    /** Stable adapter name, e.g. "hermes", "claude-code". Lower-case kebab. */
    name: string;
    capabilities: AdapterCapabilities;
    createSession(config: Record<string, unknown>): Promise<NativeSessionRef>;
    send(ref: NativeSessionRef, content: string): Promise<AgentResponse>;
    close(ref: NativeSessionRef): Promise<void>;
    getTurns(ref: NativeSessionRef): Promise<Turn[]>;
  };
  ```
- The contributor runs `pnpm run build`, `pnpm run check`, and `pnpm run test` from the repo root.

## Then
- `@sumeru/core` exports — verifiable via `import { Adapter, NativeSessionRef, AgentResponse, AdapterCapabilities } from "@sumeru/core"` from any other package — exactly these new types: `Adapter`, `NativeSessionRef`, `AgentResponse`, `AdapterCapabilities`. No additional named exports are introduced by this spec.
- All names use **`type` (string-literal unions / object types) — not `interface`, not `enum`, not `class`** — per CLAUDE.md.
- No optional properties (`?:`); fields that may be absent use `T | null` (e.g. `AgentResponse.tokens: TokenUsage | null`).
- `Adapter.name` is `string` (the project does not narrow it to a literal union — adapters are pluggable; the server identifies adapters by string match against `GatewayConfig.adapter`).
- `Adapter.capabilities` shape **matches** `GatewayCapabilities` from `@sumeru/server` (`{ resume: boolean; streaming: boolean }`). The two types are structurally identical so a server's `gateway.capabilities` can be sourced from `adapter.capabilities` in later phases without conversion. Either type can be used to type the other (e.g. `AdapterCapabilities = GatewayCapabilities` re-export, or two parallel type aliases — both acceptable, but the field set must be byte-identical).
- `NativeSessionRef.nativeId` is the **only** identifier the adapter ever sees from upstream after `createSession`. The `ses_…` Sumeru-managed ID is **not** passed into adapter methods — translation happens in the server layer.
- `AgentResponse.turns: Turn[]` reuses `Turn` from `@sumeru/core` unchanged. Adapters MUST NOT introduce a parallel turn shape.
- `AgentResponse.durationMs` is a non-negative integer (milliseconds); `tokens` follows the existing `TokenUsage` shape from core.
- Function signatures are **all `Promise`-returning** — no callback-style or sync variants — even when the underlying mechanism is synchronous, to keep the contract uniform.
- `pnpm run build` exits 0 — the new types compile under TS strict mode (no `any`, no `unchecked-index`).
- `pnpm run check` exits 0 — no Biome lint errors. The file containing the type definitions:
  - uses kebab-case file name if it's a new file (e.g. `adapter.ts`),
  - uses named exports only,
  - has no optional properties.
- `pnpm run test` exits 0. A new test file `packages/core/tests/adapter-types.test.ts` (or similar) provides at minimum:
  - A type-only test that asserts an object literal satisfying the `Adapter` shape compiles.
  - A test that proves the `Adapter` type rejects (via `@ts-expect-error`) an object that uses `?:` instead of `T | null`, returns a non-Promise from `send`, or omits `capabilities`.
- A `.changeset/<slug>.md` is present declaring `@sumeru/core` as a `minor` bump with a one-line description of the new `Adapter` type surface.
- The architecture document (`specs/architecture.md`) does NOT need to change — its TypeScript snippet at lines 70–80 is already aligned with this spec; the spec exists to commit that snippet to actual code.
- All existing Phase-1 and Phase-2 tests continue to pass.
