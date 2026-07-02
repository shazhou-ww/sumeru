# @sumeru/adapter-hermes — Hermes ACP adapter

## What it does

Sumeru adapter for **Hermes** via ACP (`hermes acp --accept-hooks`). Talks JSON-RPC over the Hermes subprocess stdin/stdout and translates ACP session updates into NDJSON turn frames.

Manifest: `providerMode: "builtin-only"` — Hermes manages its own LLM access; no Sumeru Provider/Model setup needed.

## API / Exports

- `createHermesAdapter(options?)` — returns `AdapterImpl`
- `createAcpClient`, `defaultAcpSpawn` — low-level ACP JSON-RPC client
- `manifest` — `AdapterManifest` (`name: "hermes"`)
- Types: `AcpClient`, `AcpSessionUpdate`, `HermesAdapterOptions`, `JsonRpcNotification`, …

**Binary:** `sumeru-adapter-hermes`.

## Usage example

```bash
sumeru-adapter-hermes
```

```typescript
import { createHermesAdapter, manifest } from "@sumeru/adapter-hermes";
```

Docker image tag: `sumeru/adapter-hermes:dev`. Version **0.3.0**.
