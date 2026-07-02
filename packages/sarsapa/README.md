# @sumeru/sarsapa — Native in-process worker agent (芥子)

## What it does

**Sarsapa** (芥子) is Sumeru's lightweight native agent — a single-session, in-process ReAct loop with built-in tools (shell, read, write, grep). Unlike CLI adapters, it calls LLM APIs directly via `fetch` instead of spawning an external agent binary.

Implements `AdapterImpl` and the same NDJSON protocol, but runs as a pure Node.js worker. Manifest: `providerMode: "custom-only"` — requires a configured Sumeru Provider and Model.

## API / Exports

- `createSarsapaAdapter(options?)` — returns `AdapterImpl`
- `manifest` — `AdapterManifest` (`name: "sarsapa"`)
- Types: `SarsapaOptions`, `Tool`, `ToolContext`, `ToolResult`, `LlmMessage`, …

**Binary:** `sumeru-sarsapa`.

## Usage example

```bash
sumeru-sarsapa
```

```typescript
import { createSarsapaAdapter } from "@sumeru/sarsapa";

const adapter = createSarsapaAdapter({ maxIterations: 20 });
```

Docker image tag: `sumeru/sarsapa:dev`. Version **0.3.0**.
