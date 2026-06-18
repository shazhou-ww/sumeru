---
scenario: "Server integration: @sumeru/server recognizes 'codex' as an adapter type and wires it to the Codex adapter factory"
feature: adapter-codex
tags: [adapter, codex, openai, server, integration]
---

## Given
- `@sumeru/adapter-codex` is built and exports `createCodexAdapter`.
- `@sumeru/server` has an adapter registry/factory pattern (see how `claude-code` and `hermes` are wired).
- A `sumeru.yaml` config exists with a gateway using the `codex` adapter:
  ```yaml
  gateways:
    codex-o3:
      adapter: codex
      config:
        model: o3
      capabilities:
        resume: true
        streaming: false
  ```

## When
- The server loads the config and instantiates gateways.
- A client creates a session on the `codex-o3` gateway.

## Then
- The server recognizes `adapter: codex` and calls `createCodexAdapter(config)` to instantiate the adapter.
- The gateway is registered with `name: "codex-o3"`, `adapter: "codex"`, capabilities from config.
- Session lifecycle (create, send, close) routes through the Codex adapter.
- SSE events and turn recording work identically to other adapters (the server layer handles ocas writes, not the adapter).

## Config passthrough
The gateway's `config` block is passed to `createCodexAdapter`. Recognized fields:
- `model` → `CodexAdapterOptions.model`
- `codexBin` → `CodexAdapterOptions.codexBin`
- `createSessionTimeoutMs` → `CodexAdapterOptions.createSessionTimeoutMs`
- `sendTimeoutMs` → `CodexAdapterOptions.sendTimeoutMs`
- `dangerouslyBypassApprovals` → `CodexAdapterOptions.dangerouslyBypassApprovals`
- `skipGitRepoCheck` → `CodexAdapterOptions.skipGitRepoCheck`

Unrecognized fields are ignored (forward-compatible).

## Tests
- Integration test: config with `adapter: codex` → server starts without error.
- Integration test: create session on codex gateway → returns a session with `gateway: "codex-o3"`.
- The existing server tests for hermes and claude-code adapters are unaffected.
