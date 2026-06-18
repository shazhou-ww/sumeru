---
"@sumeru/core": major
"@sumeru/adapter-hermes": major
"@sumeru/adapter-claude-code": major
"@sumeru/adapter-cursor-agent": major
"@sumeru/adapter-codex": major
"@sumeru/server": major
---

Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.
