---
"@sumeru/core": minor
"@sumeru/adapter-hermes": minor
"@sumeru/server": minor
"@sumeru/cli": minor
---

Phase 3: Hermes adapter + SSE messaging (MVP).

- `@sumeru/core` now exports the `Adapter` contract: `Adapter`,
  `NativeSessionRef`, `AgentResponse`, `AdapterCapabilities`. The contract
  uses `type` (no `interface`/`class`), no optional `?:` properties, and all
  four methods (`createSession`, `send`, `close`, `getTurns`) return Promises.
  `AdapterCapabilities` is structurally identical to `GatewayCapabilities`.
- New workspace package `@sumeru/adapter-hermes` exports
  `createHermesAdapter(opts?)` that satisfies the `Adapter` contract.
  Capabilities: `{ resume: true, streaming: false }`. Internals shell out
  to `hermes chat -q --pass-session-id --quiet --source <tag>` for create
  and `--resume <id>` for send; `getTurns` reads `~/.hermes/sessions.db`
  read-only via Node 22's `node:sqlite`. Per-`nativeId` mutex serializes
  concurrent sends. `close` is a logical close (in-memory `Set` of dead
  refs; no DB mutation, no process spawn). Argv-based content delivery so
  unicode/multiline/quotes round-trip. Configurable timeouts for create
  (60s) and send (5min).
- `@sumeru/server` integrates the adapter registry: `startServer` accepts an
  optional `adapters: Record<string, Adapter>` map; `POST .../sessions`
  calls `adapter.createSession`, stores the returned `NativeSessionRef`
  internally (never exposed in HTTP envelopes), and `DELETE .../sessions/:id`
  calls `adapter.close` before flipping status. Adapter rejections map to
  `502 adapter_error` (or `504 adapter_timeout`); missing adapter renders
  the gateway as `status: "unavailable"` and rejects writes with `503
  adapter_unavailable`.
- New SSE message endpoint `POST /gateways/:name/sessions/:id/messages`
  streams `event: turn` (`@sumeru/turn` envelope), `event: heartbeat`
  (`@sumeru/heartbeat`), `event: done` (`@sumeru/summary`), and
  `event: error` (`@sumeru/error`). Response headers:
  `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`,
  `Connection: keep-alive`, `X-Accel-Buffering: no`. Status flips
  `idle → active → idle`; concurrent send returns `409 session_busy`.
- SSE `Last-Event-ID` resume support: per-send in-memory ring buffer
  (1024 events, 30s retention after `done`). Empty-body resume = pure
  replay (does NOT re-invoke `adapter.send`); resume with body continues
  the live buffer. `400 invalid_last_event_id` for malformed values,
  `404 no_event_buffer` when no buffer exists, `410 events_evicted` /
  `410 stream_expired` for ring overflow / retention timeout.
- `@sumeru/cli`'s `start` subcommand auto-loads `@sumeru/adapter-hermes`
  and wires it into `startServer({ adapters: { hermes: createHermesAdapter() } })`.
- New `ServerConfig` fields: `sseHeartbeatMs` (default 15_000),
  `sseBufferSize` (default 1024), `sseRetentionMs` (default 30_000).
  All optional in `StartConfig` (use `null` to take the default).
