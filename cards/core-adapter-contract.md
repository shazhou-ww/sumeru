---
id: core-adapter-contract
title: "Core Adapter Contract"
sources:
  - packages/core/src/adapter.ts
  - packages/core/src/index.ts
  - packages/core/tests/adapter-types.test.ts
tags: [architecture, core, adapter, types]
created: 2026-06-15
updated: 2026-06-23
---

# Core Adapter Contract

`@sumeru/core` defines the adapter-facing type contract used by all adapter packages and by `@sumeru/server`.

## Contract Surface

`packages/core/src/adapter.ts` exports:

- `NativeSessionRef`
- `SessionConfig`
- `SendEvent`
- `Adapter`

`packages/core/src/index.ts` re-exports these as the package entrypoint type surface.

## NativeSessionRef

```ts
type NativeSessionRef = {
  nativeId: string;
  meta: Record<string, unknown>;
};
```

- `nativeId` is the adapter/agent-side session identifier.
- `meta` is adapter-owned opaque state (for example cwd/model/source tag).
- Core docs explicitly require that sensitive credentials are not stored in `meta`.

## SessionConfig

```ts
type SessionConfig = {
  model: string | null;
  cwd: string | null;
};
```

This is the standardized `createSession` input: per-session model selection and working directory, both nullable for adapter-default behavior.

## SendEvent (Streaming Refactor)

`send` no longer returns a single `AgentResponse` object. It now streams a discriminated union:

```ts
type SendEvent =
  | { type: "turn"; turn: Turn }
  | { type: "done"; durationMs: number; tokens: TokenUsage | null }
  | { type: "error"; error: Error };
```

Implications:

- `turn` events can be emitted incrementally.
- `done` is the terminal success signal with aggregate duration/tokens.
- `error` is the terminal failure signal in-stream.
- `done.tokens` is required as `TokenUsage | null` (not optional).

## Adapter Type

```ts
type Adapter = {
  name: string;
  createSession(config: SessionConfig): Promise<NativeSessionRef>;
  send(ref: NativeSessionRef, content: string): AsyncIterable<SendEvent>;
  close(ref: NativeSessionRef): Promise<void>;
  getTurns(ref: NativeSessionRef): Promise<Turn[]>;
};
```

Notable changes from older contract versions:

- `send` is `AsyncIterable<SendEvent>` (streaming-first contract).
- `capabilities` is no longer part of `Adapter`.
- `createSession` takes structured `SessionConfig` rather than generic config blobs.

## Type-Level Guardrails

`packages/core/tests/adapter-types.test.ts` enforces the new surface:

- object literals satisfying `Adapter` compile.
- `SessionConfig.model` and `.cwd` are exactly `string | null`.
- `SendEvent` discriminated union members are validated.
- adapters returning `Promise<AgentResponse>` from `send` are rejected.
- adapters including legacy `capabilities` field are rejected.

These tests lock the migration to the streaming adapter contract at compile time.
