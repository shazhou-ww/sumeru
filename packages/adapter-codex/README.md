# @sumeru/adapter-codex — OpenAI Codex CLI adapter

## What it does

Sumeru adapter for the **OpenAI Codex CLI**. Spawns the Codex subprocess, reads JSON stream output, and maps it to NDJSON turn/done frames for the Host via `@sumeru/adapter-core`.

Manifest: `providerMode: "both"` — built-in OpenAI provider or custom Provider/Model. Credential env: `OPENAI_API_KEY`.

## API / Exports

- `createCodexAdapter(options?)` — returns `AdapterImpl`
- `manifest` — `AdapterManifest` (`name: "codex"`)
- `defaultStreamingSpawn` — subprocess helper
- Stream parsers: `parseCodexJson`, `parseCodexJsonIncremental`, `doneValueFromResultLine`
- Types: `CodexAdapterOptions`, `StreamingSpawnFn`, `StreamParseEvent`, …

**Binary:** `sumeru-adapter-codex`.

## Usage example

```bash
sumeru-adapter-codex
```

```typescript
import { createCodexAdapter, manifest } from "@sumeru/adapter-codex";
```

Docker image tag: `sumeru/adapter-codex:dev`. Version **0.3.0**.
