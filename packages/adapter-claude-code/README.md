# @sumeru/adapter-claude-code — Claude Code adapter

## What it does

Sumeru adapter that drives the **Claude Code CLI** (`claude -p … --output-format stream-json`). Implements `AdapterImpl` from `@sumeru/adapter-core` and speaks the NDJSON stdin/stdout protocol. Parses stream-json output into turn frames for the Host.

Manifest: `providerMode: "both"` — supports built-in Anthropic auth or a custom Provider/Model. Credential env: `ANTHROPIC_API_KEY`.

## API / Exports

- `createClaudeCodeAdapter(options?)` — returns `AdapterImpl`
- `manifest` — `AdapterManifest` (`name: "claude-code"`)
- `defaultStreamingSpawn` — subprocess helper
- Stream parsers: `parseStreamJson`, `parseStreamJsonIncremental`, `doneValueFromResultLine`
- Types: `ClaudeCodeOptions`, `StreamingSpawnFn`, `StreamParseEvent`, …

**Binary:** `sumeru-adapter-claude-code` → calls `createAdapterEntry(createClaudeCodeAdapter())`.

## Usage example

```bash
# Container entrypoint (via Host Transport)
sumeru-adapter-claude-code

# Programmatic
import { createClaudeCodeAdapter, manifest } from "@sumeru/adapter-claude-code";
```

Docker image tag: `sumeru/adapter-claude-code:dev`. Version **0.3.0**.
