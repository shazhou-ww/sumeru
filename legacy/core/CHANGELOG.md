# Changelog

## 0.2.0 — 2026-06-26

- Add Claude Code adapter (`@sumeru/adapter-claude-code`). Spawns `claude` CLI with stream-JSON output, parses NDJSON turns, supports resume. Widen `ToolCall.output` and `ToolCall.durationMs` in core types. Update server schema registry.
- Add a `suspend` terminal event to the adapter send protocol (RFC #95 Phase 1).
  
  `@sumeru/core` `SendEvent` gains a fourth, terminal variant
  `{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }`,
  a peer of `done`/`error`. On a send timeout, all four adapters
  (claude-code, codex, cursor-agent, hermes) now yield this `suspend` event —
  carrying the agent's `nativeId` and the wall-clock `elapsedMs` — instead of an
  `error`, then return through the existing close path. The timed-out process is
  still SIGKILLed; `suspend` only records the checkpoint for a future resume
  (Phase 2). The server SSE stream emits a terminal `event: suspend` frame with a
  `{ type: "@sumeru/suspend", value: { reason, nativeId, elapsedMs } }` envelope
  (symmetric to `@sumeru/error`), then closes and returns the session to `idle`.
  A timeout is now conveyed only as `event: suspend`, never as `event: error`.
- Phase 3: Hermes adapter + SSE messaging (MVP).
  
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
- Phase 4: ocas content-addressed recording.
  
  - `@sumeru/server` now bootstraps an `@ocas/fs`-backed CAS store at startup
    via `openSumeruOcas(dir)`, registers the `@sumeru/turn` and
    `@sumeru/session-meta` JSON Schemas, and exposes the live `Store` plus
    the schema hashes through a new `ServerConfig.ocas` slice.
  - New CLI flag `sumeru start --ocas-dir <path>` selects the on-disk store
    location. Resolution: `--ocas-dir` > `$SUMERU_OCAS_DIR` > `~/.sumeru/ocas`.
    The resolved path is logged on startup. Filesystem errors (EACCES,
    ENOSPC, EROFS) reject `startServer` before the listener binds.
  - Schema bodies live in `packages/server/src/ocas/schemas.ts` as
    byte-stable contracts. Hashes are computed by `@ocas/core` and exposed
    via `SumeruOcas.{turnSchemaHash, sessionMetaSchemaHash, metaSchemaHash}`.
    Payloads are validated against their schema before they reach disk
    (local ajv with a permissive `date-time` format registered).
  - `POST /gateways/:name/sessions` writes a `@sumeru/session-meta` node
    to ocas BEFORE the in-memory session is registered. The hash is held
    internally on `Session.metaHash` and never serialized in the wire
    envelope. Validation/IO failures return `500 ocas_write_failed` and
    leave both the in-memory store AND ocas untouched (atomicity).
  - `POST /gateways/:name/sessions/:id/messages` records the user turn
    before invoking `adapter.send`, then records each assistant turn from
    the adapter response. Each turn hash is appended to
    `Session.turnHashes` and stamped onto the SSE `event: turn` payload
    via `value.hash`. The hash is server-injected; it is NOT stored INSIDE
    the ocas payload (would be circular). Adapter failures still leave
    the user turn recorded; concurrent-send 409s write nothing.
  - New endpoint `GET /gateways/:name/sessions/:id/messages` returns the
    full ordered turn history sourced from ocas via `Session.turnHashes`,
    wrapped as `@sumeru/message-history`. Supports `?offset` and `?limit`
    (cap 1000); echoes both in the response. Closed sessions remain
    readable. `Cache-Control: no-store`.
  - New endpoint `GET /ocas/:hash` returns any node in the store as
    `{ type, value }`. Schema aliases (`@sumeru/turn`,
    `@sumeru/session-meta`, `@ocas/schema`) render `type` as a friendly
    name; unknown types fall back to the raw hash. Hash format is
    validated via `^[0-9A-HJKMNP-TV-Z]{13}$`. Response carries
    `Cache-Control: public, max-age=31536000, immutable` and
    `ETag: "<hash>"`; `If-None-Match` returns `304 Not Modified` with no
    body. `404 ocas_not_found` for valid-format hashes that miss;
    `400 invalid_hash` for malformed input; `405 method_not_allowed` with
    `Allow: GET` for non-GET methods.
  - `@sumeru/core.Turn` gains an optional `hash: string | null` field so
    adapters can return turns without a hash and the server can stamp the
    ocas-computed hash onto SSE / history responses. The hash is excluded
    from the recorded payload.
  - `@sumeru/server` now declares `@ocas/core` and `@ocas/fs` as runtime
    dependencies and adds `ajv` for payload pre-validation.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

## 1.0.0 — 2026-06-26

- Add Claude Code adapter (`@sumeru/adapter-claude-code`). Spawns `claude` CLI with stream-JSON output, parses NDJSON turns, supports resume. Widen `ToolCall.output` and `ToolCall.durationMs` in core types. Update server schema registry.
- Add a `suspend` terminal event to the adapter send protocol (RFC #95 Phase 1).
  
  `@sumeru/core` `SendEvent` gains a fourth, terminal variant
  `{ type: "suspend"; reason: "timeout"; nativeId: string; elapsedMs: number }`,
  a peer of `done`/`error`. On a send timeout, all four adapters
  (claude-code, codex, cursor-agent, hermes) now yield this `suspend` event —
  carrying the agent's `nativeId` and the wall-clock `elapsedMs` — instead of an
  `error`, then return through the existing close path. The timed-out process is
  still SIGKILLed; `suspend` only records the checkpoint for a future resume
  (Phase 2). The server SSE stream emits a terminal `event: suspend` frame with a
  `{ type: "@sumeru/suspend", value: { reason, nativeId, elapsedMs } }` envelope
  (symmetric to `@sumeru/error`), then closes and returns the session to `idle`.
  A timeout is now conveyed only as `event: suspend`, never as `event: error`.
- Phase 3: Hermes adapter + SSE messaging (MVP).
  
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
- Phase 4: ocas content-addressed recording.
  
  - `@sumeru/server` now bootstraps an `@ocas/fs`-backed CAS store at startup
    via `openSumeruOcas(dir)`, registers the `@sumeru/turn` and
    `@sumeru/session-meta` JSON Schemas, and exposes the live `Store` plus
    the schema hashes through a new `ServerConfig.ocas` slice.
  - New CLI flag `sumeru start --ocas-dir <path>` selects the on-disk store
    location. Resolution: `--ocas-dir` > `$SUMERU_OCAS_DIR` > `~/.sumeru/ocas`.
    The resolved path is logged on startup. Filesystem errors (EACCES,
    ENOSPC, EROFS) reject `startServer` before the listener binds.
  - Schema bodies live in `packages/server/src/ocas/schemas.ts` as
    byte-stable contracts. Hashes are computed by `@ocas/core` and exposed
    via `SumeruOcas.{turnSchemaHash, sessionMetaSchemaHash, metaSchemaHash}`.
    Payloads are validated against their schema before they reach disk
    (local ajv with a permissive `date-time` format registered).
  - `POST /gateways/:name/sessions` writes a `@sumeru/session-meta` node
    to ocas BEFORE the in-memory session is registered. The hash is held
    internally on `Session.metaHash` and never serialized in the wire
    envelope. Validation/IO failures return `500 ocas_write_failed` and
    leave both the in-memory store AND ocas untouched (atomicity).
  - `POST /gateways/:name/sessions/:id/messages` records the user turn
    before invoking `adapter.send`, then records each assistant turn from
    the adapter response. Each turn hash is appended to
    `Session.turnHashes` and stamped onto the SSE `event: turn` payload
    via `value.hash`. The hash is server-injected; it is NOT stored INSIDE
    the ocas payload (would be circular). Adapter failures still leave
    the user turn recorded; concurrent-send 409s write nothing.
  - New endpoint `GET /gateways/:name/sessions/:id/messages` returns the
    full ordered turn history sourced from ocas via `Session.turnHashes`,
    wrapped as `@sumeru/message-history`. Supports `?offset` and `?limit`
    (cap 1000); echoes both in the response. Closed sessions remain
    readable. `Cache-Control: no-store`.
  - New endpoint `GET /ocas/:hash` returns any node in the store as
    `{ type, value }`. Schema aliases (`@sumeru/turn`,
    `@sumeru/session-meta`, `@ocas/schema`) render `type` as a friendly
    name; unknown types fall back to the raw hash. Hash format is
    validated via `^[0-9A-HJKMNP-TV-Z]{13}$`. Response carries
    `Cache-Control: public, max-age=31536000, immutable` and
    `ETag: "<hash>"`; `If-None-Match` returns `304 Not Modified` with no
    body. `404 ocas_not_found` for valid-format hashes that miss;
    `400 invalid_hash` for malformed input; `405 method_not_allowed` with
    `Allow: GET` for non-GET methods.
  - `@sumeru/core.Turn` gains an optional `hash: string | null` field so
    adapters can return turns without a hash and the server can stamp the
    ocas-computed hash onto SSE / history responses. The hash is excluded
    from the recorded payload.
  - `@sumeru/server` now declares `@ocas/core` and `@ocas/fs` as runtime
    dependencies and adds `ajv` for payload pre-validation.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

