# @sumeru/adapter-cursor-agent — Cursor Agent CLI adapter

## What it does

Sumeru adapter for the **Cursor Agent CLI**. Shells out to the Cursor agent binary, parses its stream-json output, and exposes turns through the standard NDJSON adapter protocol.

Manifest: `providerMode: "builtin-only"` — uses Cursor's platform provider; no Sumeru Provider/Model entities required. Credential env: `CURSOR_API_KEY`.

## API / Exports

- `createCursorAgentAdapter(options?)` — returns `AdapterImpl`
- `manifest` — `AdapterManifest` (`name: "cursor-agent"`)
- `defaultStreamingSpawn` — subprocess helper
- Stream parsers: `parseStreamJson`, `parseStreamJsonIncremental`, `doneValueFromResultLine`
- Types: `CursorAgentOptions`, `StreamingSpawnFn`, `StreamParseEvent`, …

**Binary:** `sumeru-adapter-cursor-agent`.

## Usage example

```bash
sumeru-adapter-cursor-agent
```

```typescript
import { createCursorAgentAdapter } from "@sumeru/adapter-cursor-agent";
```

Docker image tag: `sumeru/adapter-cursor-agent:dev`. Version **0.3.0**.
