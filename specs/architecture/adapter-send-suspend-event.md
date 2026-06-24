---
scenario: "@sumeru/core SendEvent gains a fourth terminal variant `suspend` (alongside done/error) so adapters can report a send timeout as a recoverable pause carrying nativeId + elapsedMs"
feature: core-adapter
tags: [core, adapter, types, suspend, timeout, streaming, phase-1]
---

## Given
- `@sumeru/core` defines `SendEvent` in `packages/core/src/adapter.ts:48-51` as a three-variant discriminated union on `type`:
  ```typescript
  export type SendEvent =
    | { type: "turn"; turn: Turn }
    | { type: "done"; durationMs: number; tokens: TokenUsage | null }
    | { type: "error"; error: Error };
  ```
  The JSDoc block at lines 41-47 documents only `turn` / `done` / `error`.
- `SendEvent` is the event stream yielded by `Adapter.send(ref, content): AsyncIterable<SendEvent>`.
- Every consumer dispatches on `event.type` via `if (event.type === "turn") … else if (… "done") … else if (… "error")` chains:
  - server: `packages/server/src/sse/messages.ts:364/443/458`
  - adapters: `packages/adapter-*/src/adapter.ts` (turn/result handling + a `timedOut` branch that currently yields `error`)
- A type-level test lives at `packages/core/tests/adapter-types.test.ts`.
- RFC #95 locks the semantics: a single `send` has exactly three terminal outcomes — `done` (success), `error` (failure), and the new `suspend` (paused, resumable). `suspend` is a **terminal** event peer to `done`/`error`, NOT a peer to `turn`.

## When
- The contributor adds a fourth variant to `SendEvent`, placed **between `done` and `error`** to preserve the canonical `turn` / `done` / `suspend` / `error` ordering:
  ```typescript
  export type SendEvent =
    | { type: "turn"; turn: Turn }
    | { type: "done"; durationMs: number; tokens: TokenUsage | null }
    | { type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }
    | { type: "error"; error: Error };
  ```
- The contributor updates the JSDoc above the type (lines 41-47) to document `suspend`: a terminal event meaning the send was interrupted (currently only by timeout) and may be resumed later via the carried `nativeId`; the agent process has already been killed.
- The contributor runs `pnpm run typecheck`, `pnpm run build`, `pnpm run check`, and `pnpm run test` from the repo root.

## Then
- `SendEvent` is a four-variant discriminated union; the new member is exactly `{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }`.
  - `reason` is the **string literal type** `"timeout"` (not a free `string`) — it reserves room for future suspend reasons while pinning the only Phase 1 cause.
  - `nativeId: string` and `elapsedMs: number` are **required, non-nullable** fields. No optional (`?:`) properties (per CLAUDE.md; nullable would use `T | null`, but neither field is nullable here).
- All four variants are defined with `type` (not `interface`/`enum`/`class`), named-exported, consistent with the rest of `adapter.ts`.
- **Exhaustiveness is enforced by the compiler, intentionally.** Because `SendEvent` is consumed by `if/else if` chains and (where present) `switch (event.type)`, adding the variant surfaces every consumer that has not yet handled `suspend`. `pnpm run typecheck` must end at exit 0 **only after** all four adapters and the server explicitly handle the `suspend` case — an unhandled `suspend` that leaks a non-`never` type into an exhaustive position is a compile error, and that is the desired guard against silent omission (see testing issue #98 Step 1).
- `grep -n 'type: "suspend"' packages/core/src/adapter.ts` matches exactly one line (the union variant).
- `packages/core/tests/adapter-types.test.ts` is extended to assert:
  - An object literal `{ type: "suspend", reason: "timeout", nativeId: "abc", elapsedMs: 1234 }` is assignable to `SendEvent`.
  - `// @ts-expect-error` rejects a `suspend` event missing `nativeId` or `elapsedMs`, and rejects `reason` values other than `"timeout"`.
  - Existing `turn` / `done` / `error` assertions continue to pass.
- `pnpm run build` exits 0, `pnpm run check` exits 0 (no Biome errors), `pnpm run test` exits 0.
- A `.changeset/<slug>.md` declares `@sumeru/core` (and the downstream packages that newly handle the variant) a **minor** bump — additive `suspend` terminal event; no field removed or renamed.

## Notes
- This is the protocol-layer change of RFC #95 Phase 1. It does NOT change runtime timeout behavior on its own — the `spawn.ts` SIGTERM→SIGKILL timer is untouched. Suspend only records the `nativeId` for a future `--resume`; "continuing" is a Phase 2 concern (broker + `uwf thread resume`) and out of scope here.
- `elapsedMs` is the wall-clock duration the killed send ran before the timeout fired; adapters source it from their existing exit/timing info (`exitInfo.durationMs` for the streaming adapters, `Date.now() - startedAt` for hermes).
