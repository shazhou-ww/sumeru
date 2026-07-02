# @sumeru/core — Shared type definitions for Sumeru

## What it does

Zero-runtime-dependency TypeScript types shared across the Sumeru monorepo. Defines the domain model for providers, models, personas, prototypes, sessions, and turn streams. This package is type-only — no functions, classes, or runtime values are exported.

Use it whenever two packages need the same shape for Host API payloads, adapter config, or session records.

## API / Exports

All types are re-exported from `src/types.ts`:

| Category | Types |
|----------|-------|
| Registry | `Provider`, `Model`, `Persona`, `Skill`, `Extension`, `Prototype` |
| Session | `SessionInfo`, `SessionStatus`, `ExitSignal`, `TokenUsage` |
| Model config | `ModelConfig`, `KnownProvider`, `CustomProvider` |
| Turns | `Turn`, `AssistantTurn`, `ToolTurn`, `ToolCall` |
| Host config | `HostConfig` |

## Usage example

```typescript
import type { SessionInfo, Prototype, Turn } from "@sumeru/core";

function describeSession(session: SessionInfo): string {
  return `${session.id} [${session.status}] — ${session.prototype}`;
}
```

Workspace dependency: `"@sumeru/core": "workspace:*"`. Version **0.3.0**.
