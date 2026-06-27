---
"@sumeru/core": minor
---

feat: add @sumeru/core M1 minimal type set (M1-2, #123)

Replace the scaffold `VERSION` placeholder with the initial public type surface
defined in package-design wiki §1. `packages/core/src/types.ts` now declares the
zero-runtime minimal type set, re-exported through `src/index.ts`:

- Manifest & Model — `Manifest`, `ModelConfig`, `KnownProvider`, `CustomProvider`
- Instance — `InstanceId`, `InstanceStatus`, `InstanceInfo`
- 消息协议 — `InboxMessage`, `OutboxFrame`, `TurnValue`, `ToolCall`, `DoneValue`,
  `SuspendValue`, `ErrorValue`, `TokenUsage`
- Host 配置 — `HostConfig`, `MasterConfig`, `ResourceLimits`

`OutboxFrame` is a discriminated union keyed on `type` (turn/done/suspend/error)
with `never`-based exhaustiveness. The package stays zero-runtime-deps; a
compile-time conformance test (`tests/types.test.ts`) constructs a literal of
each type and guards the union against drift.

Refs: #123
