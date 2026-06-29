---
scenario: "OutboxFrame is a discriminated union keyed on `type` with exactly four members (turn/done/suspend/error); switching on `frame.type` narrows `frame.value` to the matching payload type and a default branch is statically unreachable (exhaustive)"
feature: core-message-protocol
tags: [core, types, message-protocol, outbox, discriminated-union, m1-2, issue-123, phase-v2]
---

## Given
- This spec narrows in on the **消息协议 (Host ↔ Adapter NDJSON 帧)** portion of the `@sumeru/core` minimal type set defined by `core-types-minimal-set.md`; the type-surface, export, and convention requirements there still apply and are not repeated here.
- Per [package-design wiki §1](https://git.shazhou.work/shazhou/sumeru/wiki/package-design#1-sumerucore--共享类型) and the Adapter lifecycle in [wiki §4](https://git.shazhou.work/shazhou/sumeru/wiki/package-design), `OutboxFrame` is the typed envelope an adapter writes to stdout (and the Host re-emits on the SSE `outbox`). It is a **tagged/discriminated union keyed on the literal `type` field**:
  ```typescript
  type OutboxFrame =
    | { type: 'turn'; value: TurnValue }
    | { type: 'done'; value: DoneValue }
    | { type: 'suspend'; value: SuspendValue }
    | { type: 'error'; value: ErrorValue }
  ```
  with payloads:
  - `TurnValue` = `{ index: number; role: 'user' | 'assistant' | 'system'; content: string; timestamp: string; toolCalls: Array<ToolCall> | null; tokens: TokenUsage | null }`
  - `DoneValue` = `{ summary: string | null; tokenUsage: TokenUsage | null }`
  - `SuspendValue` = `{ reason: 'timeout' | 'permissionRequest' | 'inputRequired'; elapsedMs: number }`
  - `ErrorValue` = `{ code: string; message: string }`
  - `ToolCall` = `{ tool: string; input: Record<string, unknown>; output: string | null; durationMs: number | null; exitCode: number | null }`
  - `TokenUsage` = `{ input: number; output: number }`
- `InboxMessage` = `{ messageId: string; content: string; project: string | null }` is the inbound counterpart (single shape, not a union).
- Conventions: all properties camelCase; literal-string unions for the closed enumerations (`role`, `SuspendValue.reason`); `| null` instead of optional `?:`; `type` not `interface`.

## When
- A consumer (e.g. the Host's outbox handler) writes an exhaustive narrowing over a frame and compiles under the repo's strict `tsc`:
  ```typescript
  import type { OutboxFrame, TurnValue, DoneValue, SuspendValue, ErrorValue } from "@sumeru/core";

  function describe(frame: OutboxFrame): string {
    switch (frame.type) {
      case "turn":    { const v: TurnValue    = frame.value; return `turn#${v.index}`; }
      case "done":    { const v: DoneValue    = frame.value; return v.summary ?? "done"; }
      case "suspend": { const v: SuspendValue = frame.value; return v.reason; }
      case "error":   { const v: ErrorValue   = frame.value; return v.code; }
      default: { const _never: never = frame; return _never; } // exhaustiveness guard
    }
  }
  ```
- The contributor runs `pnpm run typecheck` and `pnpm run test`.

## Then
- **Discrimination works:** inside each `case`, `frame.value` is narrowed to exactly the matching payload type — assigning `frame.value` to `TurnValue` under `case "turn"`, to `DoneValue` under `case "done"`, to `SuspendValue` under `case "suspend"`, and to `ErrorValue` under `case "error"` all type-check with **no cast**.
- **Exhaustiveness:** the `default` branch's `const _never: never = frame;` compiles, proving the four listed members are the *only* members of `OutboxFrame`. If a fifth member were added (or one removed/renamed) without updating consumers, this assignment would fail `tsc` — the union is closed at exactly `turn | done | suspend | error`.
- **Cross-discriminant safety:** accessing a payload field that belongs to a *different* variant is a compile error — e.g. reading `frame.value.reason` under `case "turn"`, or `frame.value.index` under `case "error"`, fails `tsc` (the narrowed `value` does not carry that field).
- **Literal-union closedness:**
  - `TurnValue.role` accepts only `'user' | 'assistant' | 'system'`; any other string literal (e.g. `'tool'`) is rejected by `tsc`.
  - `SuspendValue.reason` accepts only `'timeout' | 'permissionRequest' | 'inputRequired'` (the three reasons named in wiki §4 design-decision 4); any other literal is rejected.
- **Nullability, not optionality:** `TurnValue.toolCalls`, `TurnValue.tokens`, `DoneValue.summary`, `DoneValue.tokenUsage`, `ToolCall.output`, `ToolCall.durationMs`, `ToolCall.exitCode`, and `InboxMessage.project` are each `T | null` and are **required keys** — omitting the key (rather than setting it to `null`) is a `tsc` error, confirming no `?:` optional was used.
- **Name fidelity:** the per-frame payload accessor is `value` for all four members (`{ type; value }`), and the two token fields keep their distinct wiki names — `TurnValue.tokens` vs `DoneValue.tokenUsage`.
- A `tests/` file encodes the above as a compile-time conformance check: it constructs one literal `OutboxFrame` of **each** of the four `type` variants, asserts (at runtime, trivially) the `type` tag round-trips, and includes the `never` exhaustiveness guard so the suite fails closed if the union drifts. `pnpm run typecheck` and `pnpm run test` both exit 0.
