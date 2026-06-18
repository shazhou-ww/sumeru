---
scenario: "@sumeru/core exports a streaming-first Adapter contract: SessionConfig, SendEvent, and Adapter.send returns AsyncIterable<SendEvent>; AgentResponse and AdapterCapabilities are removed"
feature: core-adapter
tags: [core, adapter, types, streaming, breaking]
---

## Given
- `@sumeru/core` currently exports `Adapter`, `AgentResponse`, `AdapterCapabilities`, and `NativeSessionRef` from `packages/core/src/adapter.ts`.
- `Adapter.send` currently returns `Promise<AgentResponse>` — the server must wait for the entire agent run before emitting any turns.
- `Adapter.createSession` currently takes `config: Record<string, unknown>`.
- `Adapter` currently has a `capabilities: AdapterCapabilities` field.
- All four adapter packages (`adapter-hermes`, `adapter-claude-code`, `adapter-cursor-agent`, `adapter-codex`) import `AgentResponse` and `AdapterCapabilities` from `@sumeru/core`.
- `@sumeru/server` imports `AgentResponse` from `@sumeru/core` in `packages/server/src/sse/messages.ts`.

## When
- The contributor replaces the contents of `packages/core/src/adapter.ts` with the new contract:
  ```typescript
  import type { TokenUsage, Turn } from "./types.js";

  export type NativeSessionRef = {
    nativeId: string;
    meta: Record<string, unknown>;
  };

  export type SessionConfig = {
    model: string | null;
    cwd: string | null;
  };

  export type SendEvent =
    | { type: "turn"; turn: Turn }
    | { type: "done"; durationMs: number; tokens: TokenUsage | null }
    | { type: "error"; error: Error };

  export type Adapter = {
    name: string;
    createSession(config: SessionConfig): Promise<NativeSessionRef>;
    send(ref: NativeSessionRef, content: string): AsyncIterable<SendEvent>;
    close(ref: NativeSessionRef): Promise<void>;
    getTurns(ref: NativeSessionRef): Promise<Turn[]>;
  };
  ```
- The contributor updates `packages/core/src/index.ts` to export `SessionConfig` and `SendEvent` and to remove the re-exports of `AgentResponse` and `AdapterCapabilities`.
- The contributor runs `pnpm run build`, `pnpm run check`, and `pnpm run test` from the repo root.

## Then
- `@sumeru/core` exports exactly: `Adapter`, `NativeSessionRef`, `SessionConfig`, `SendEvent` from `adapter.ts`. No `AgentResponse`. No `AdapterCapabilities`.
- `NativeSessionRef` is unchanged: `{ nativeId: string; meta: Record<string, unknown> }`.
- `SessionConfig` has exactly two fields: `model: string | null` and `cwd: string | null`. No optional properties.
- `SendEvent` is a discriminated union on `type`:
  - `{ type: "turn"; turn: Turn }` — a single turn produced by the agent.
  - `{ type: "done"; durationMs: number; tokens: TokenUsage | null }` — signals completion with wall-clock duration and optional token usage.
  - `{ type: "error"; error: Error }` — signals an adapter-level error.
- `Adapter.createSession` takes `config: SessionConfig` (NOT `Record<string, unknown>`). It only acquires a native session id — no initial query is sent.
- `Adapter.send` returns `AsyncIterable<SendEvent>` (NOT `Promise<AgentResponse>`). The iterable yields `turn` events as they are produced, then a final `done` event. On failure mid-stream, yields an `error` event and terminates.
- `Adapter` has no `capabilities` field.
- All type definitions use `type` (not `interface`, not `class`, not `enum`) per CLAUDE.md.
- No optional properties (`?:`); nullable fields use `T | null`.
- `pnpm run build` exits 0 — compiles under TS strict mode.
- `pnpm run check` exits 0 — no Biome lint errors.
- `pnpm run test` exits 0 — updated type tests in `packages/core/tests/` verify:
  - An object literal satisfying the new `Adapter` shape compiles.
  - `@ts-expect-error` rejects an `Adapter` whose `send` returns `Promise<AgentResponse>`.
  - `@ts-expect-error` rejects an `Adapter` that has a `capabilities` field but not the new shape.
  - `SessionConfig` and `SendEvent` are importable and type-check correctly.
- Existing tests for `Turn`, `TokenUsage`, etc. continue to pass.
- A `.changeset/<slug>.md` is present declaring `@sumeru/core` as a `major` bump (breaking: `AgentResponse` and `AdapterCapabilities` removed, `send` return type changed, `createSession` param type changed).
