---
scenario: "Server integration: @sumeru/server recognizes 'cursor-agent' as an adapter type and wires it to the Cursor Agent adapter factory"
feature: adapter-cursor-agent
tags: [adapter, cursor-agent, server, integration]
---

## Given
- `@sumeru/adapter-cursor-agent` is built and exports `createCursorAgentAdapter`.
- `@sumeru/server` has an adapter registry/factory pattern (see how `claude-code`, `codex`, and `hermes` are wired).
- A `sumeru.yaml` config exists with a gateway using the `cursor-agent` adapter:
  ```yaml
  gateways:
    cursor-agent:
      adapter: cursor-agent
      config:
        model: gpt-5
      capabilities:
        resume: true
        streaming: true
  ```

## When
- The server loads the config and instantiates gateways.
- A client creates a session on the `cursor-agent` gateway.

## Then
- The server recognizes `adapter: cursor-agent` and calls `createCursorAgentAdapter(config)` to instantiate the adapter.
- The gateway is registered with `name: "cursor-agent"`, `adapter: "cursor-agent"`, capabilities from config.
- Session lifecycle (create, send, close) routes through the Cursor Agent adapter.
- SSE events and turn recording work identically to other adapters (the server layer handles ocas writes, not the adapter).

## Config passthrough
The gateway's `config` block is passed to `createCursorAgentAdapter`. Recognized fields:
- `model` → `CursorAgentAdapterOptions.model`
- `cursorAgentBin` → `CursorAgentAdapterOptions.cursorAgentBin`
- `cwd` → `CursorAgentAdapterOptions.cwd`
- `createSessionTimeoutMs` → `CursorAgentAdapterOptions.createSessionTimeoutMs`
- `sendTimeoutMs` → `CursorAgentAdapterOptions.sendTimeoutMs`
- `permissionMode` → `CursorAgentAdapterOptions.permissionMode` (`"force"` | `"yolo"`)
- `sandbox` → `CursorAgentAdapterOptions.sandbox` (`"enabled"` | `"disabled"`)

Unrecognized fields are ignored (forward-compatible).

## Tests
- Integration test: config with `adapter: cursor-agent` → server starts without error.
- Integration test: create session on cursor-agent gateway → returns a session with `gateway: "cursor-agent"`.
- The existing server tests for hermes, claude-code, and codex adapters are unaffected.
