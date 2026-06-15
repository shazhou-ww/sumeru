---
id: core-adapter-contract
title: "Core Types and Adapter Contract"
sources:
  - packages/core/src/types.ts
  - packages/core/src/adapter.ts
  - packages/core/src/index.ts
tags: [architecture, core, adapter, types]
created: 2026-06-15
updated: 2026-06-15
---

# Core Types and Adapter Contract

`@sumeru/core` is the foundational package — it defines the data shapes shared across all other packages and the Adapter contract that every agent integration must implement.

## Turn and ToolCall

A `Turn` represents a single conversational exchange:

```typescript
type Turn = {
  index: number;                    // 0-indexed sequence number
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;                // ISO 8601
  toolCalls: ToolCall[] | null;     // assistant turns only
  tokens: TokenUsage | null;
  hash: string | null;              // ocas hash, set by server (not adapter)
};
```

Key design decisions:
- `hash` is always `null` from adapters — the server layer computes and fills it before emitting SSE events or history responses (avoids circular hashing).
- `toolCalls` is `null` (not empty array) when no tool calls exist, following the "no optional properties" convention.

A `ToolCall` captures a single tool invocation within an assistant turn:

```typescript
type ToolCall = {
  tool: string;                     // e.g. "terminal", "read_file"
  input: Record<string, unknown>;
  output: string | null;            // null when no result paired yet
  durationMs: number | null;        // null when timing unavailable
  exitCode: number | null;          // terminal calls only
};
```

## TokenUsage

Simple input/output token accounting:

```typescript
type TokenUsage = {
  input: number;
  output: number;
};
```

Used in both per-turn tracking (`Turn.tokens`) and aggregate reporting (`AgentResponse.tokens`, `RecordingMeta.tokens`).

## NativeSessionRef

The bridge between Sumeru's session model (`ses_` + ULID) and the agent's own session identity:

```typescript
type NativeSessionRef = {
  nativeId: string;                 // agent's own ID (e.g. Hermes timestamp hash)
  meta: Record<string, unknown>;    // opaque adapter bookkeeping (cwd, model, etc.)
};
```

The server layer translates between Sumeru session IDs and native refs — adapter methods never receive `ses_*` IDs directly.

## AdapterCapabilities

Feature flags exposed by each adapter:

```typescript
type AdapterCapabilities = {
  resume: boolean;      // can resume an existing session
  streaming: boolean;   // supports streaming responses
};
```

These map 1:1 to `GatewayCapabilities` in `@sumeru/server` — no conversion needed when wiring gateway config from adapter metadata.

## The Adapter Contract

Every agent integration implements this interface:

```typescript
type Adapter = {
  name: string;                     // stable kebab-case identifier
  capabilities: AdapterCapabilities;
  createSession(config: Record<string, unknown>): Promise<NativeSessionRef>;
  send(ref: NativeSessionRef, content: string): Promise<AgentResponse>;
  close(ref: NativeSessionRef): Promise<void>;
  getTurns(ref: NativeSessionRef): Promise<Turn[]>;
};
```

| Method | Responsibility |
|--------|---------------|
| `createSession` | Spawn or connect to an agent process, return a native ref |
| `send` | Deliver user content, wait for full response, return turns produced |
| `close` | Tear down the agent session (kill process, release resources) |
| `getTurns` | Retrieve the full turn history from the agent's native storage |

All methods return Promises for uniformity, even when the underlying implementation is synchronous.

## AgentResponse

The return type of `Adapter.send`:

```typescript
type AgentResponse = {
  turns: Turn[];              // turns produced during this send, in order
  tokens: TokenUsage | null;  // aggregated usage, null if unreported
  durationMs: number;         // wall-clock duration (non-negative integer)
};
```

## Legacy / Planned Types

The package also defines types for a planned Docker-based recording mode:

- **Scene** — world + task definition (tools, knowledge, task prompt) independent of any agent
- **RunConfig** — runtime parameters (runner, model, timeout, Docker image)
- **Recording** / **RecordingMeta** — captured run artifacts with timing and exit status

These are exported but currently unused by the HTTP service; they exist for an upcoming Docker recording flow.

## Package Exports

`@sumeru/core` re-exports all types from a single entry point (`index.ts`). All exports are type-only — no runtime code ships from this package.
