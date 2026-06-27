# Changelog

## 0.2.0 — 2026-06-26

- fix(adapter-hermes): hermes v0.15.1 compatibility (closes #23).
  
  - `createSession` now merges `stderr + stdout` when searching for the session
    id line. hermes v0.15.1 emits `session_id: <id>` to **stderr** under
    `--quiet --pass-session-id`; previously the adapter only scanned stdout and
    always rejected with `failed to parse Hermes session id`.
  - `SESSION_LINE_RE` accepts both formats: `/^(?:Session:|session_id:)\s+(\S+)\s*$/m`.
    Legacy `Session: <id>` (stdout, non-quiet mode) still works; new
    `session_id: <id>` (stderr, --quiet mode) now works too. The parse-failure
    error message includes both streams so debugging is no longer one-eyed.
  - New JSONL-first turn reader (`src/jsonl.ts`): `getTurns` and `send` first
    look for `~/.hermes/sessions/<nativeId>.jsonl`. Hermes v0.15.1 writes turn
    history there, not into `sessions.db` (which is empty under v0.15.1). The
    SQLite path remains as a fallback for older hermes builds.
  - `db.ts` now detects schema shape at read time and supports the uwf-shaped
    v2 layout (`sessions(id, model, started_at, …)` + `messages(session_id,
    role, content, reasoning, tool_calls)`) in addition to the legacy v1
    shape. The new `SCHEMA_VERSION_DB = 2` constant is exported alongside
    the existing `SCHEMA_VERSION = 1`.
  - `HermesAdapterOptions` gains two `T | null` fields: `sessionsDir`
    (defaults to `~/.hermes/sessions`) and `jsonlReader` (test seam parallel
    to `turnsReader`).
  - Empty JSONL → `[]` (legitimate "session created, no turns yet"); JSONL
    exists but every line is malformed → fall through to DB; one bad line is
    skipped silently. Missing JSONL + missing DB → `[]`, not an error.
- Resolve per-call `config.cwd` consistently across both adapters (#53 #54 #66).
  
  Both `createHermesAdapter` and `createClaudeCodeAdapter` now apply one
  byte-identical 5-case cwd policy in `createSession`:
  
  1. a non-empty per-call `config.cwd` wins;
  2. else the constructor `cwd`;
  3. else `process.cwd()`;
  4. a non-null, non-string `config.cwd` is rejected with an `Error`
     (`"config.cwd must be a string"`) before any process is spawned;
  5. an empty-string `config.cwd` is treated as absent.
  
  The resolved value is used for BOTH the spawned process's working directory
  and `ref.meta.cwd`, so they can never diverge. cwd travels solely via
  `child_process.spawn`'s `cwd` option — there is no `--cwd` CLI flag.
  
  - adapter-hermes: adds a `cwd: string | null` constructor option, a required
    `cwd` field on `SpawnArgs`, and forwards it through `defaultSpawn`. `send`
    now pins the resume spawn to `ref.meta.cwd` (falling back to the resolved
    default for legacy hand-built refs), fixing #66 where resumes inherited the
    server's `process.cwd()`.
  - adapter-claude-code: adds the Case-4 non-string rejection (#54); the
    existing per-call/constructor/`process.cwd()` resolution is unchanged.
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
- Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

## 1.0.0 — 2026-06-26

- fix(adapter-hermes): hermes v0.15.1 compatibility (closes #23).
  
  - `createSession` now merges `stderr + stdout` when searching for the session
    id line. hermes v0.15.1 emits `session_id: <id>` to **stderr** under
    `--quiet --pass-session-id`; previously the adapter only scanned stdout and
    always rejected with `failed to parse Hermes session id`.
  - `SESSION_LINE_RE` accepts both formats: `/^(?:Session:|session_id:)\s+(\S+)\s*$/m`.
    Legacy `Session: <id>` (stdout, non-quiet mode) still works; new
    `session_id: <id>` (stderr, --quiet mode) now works too. The parse-failure
    error message includes both streams so debugging is no longer one-eyed.
  - New JSONL-first turn reader (`src/jsonl.ts`): `getTurns` and `send` first
    look for `~/.hermes/sessions/<nativeId>.jsonl`. Hermes v0.15.1 writes turn
    history there, not into `sessions.db` (which is empty under v0.15.1). The
    SQLite path remains as a fallback for older hermes builds.
  - `db.ts` now detects schema shape at read time and supports the uwf-shaped
    v2 layout (`sessions(id, model, started_at, …)` + `messages(session_id,
    role, content, reasoning, tool_calls)`) in addition to the legacy v1
    shape. The new `SCHEMA_VERSION_DB = 2` constant is exported alongside
    the existing `SCHEMA_VERSION = 1`.
  - `HermesAdapterOptions` gains two `T | null` fields: `sessionsDir`
    (defaults to `~/.hermes/sessions`) and `jsonlReader` (test seam parallel
    to `turnsReader`).
  - Empty JSONL → `[]` (legitimate "session created, no turns yet"); JSONL
    exists but every line is malformed → fall through to DB; one bad line is
    skipped silently. Missing JSONL + missing DB → `[]`, not an error.
- Resolve per-call `config.cwd` consistently across both adapters (#53 #54 #66).
  
  Both `createHermesAdapter` and `createClaudeCodeAdapter` now apply one
  byte-identical 5-case cwd policy in `createSession`:
  
  1. a non-empty per-call `config.cwd` wins;
  2. else the constructor `cwd`;
  3. else `process.cwd()`;
  4. a non-null, non-string `config.cwd` is rejected with an `Error`
     (`"config.cwd must be a string"`) before any process is spawned;
  5. an empty-string `config.cwd` is treated as absent.
  
  The resolved value is used for BOTH the spawned process's working directory
  and `ref.meta.cwd`, so they can never diverge. cwd travels solely via
  `child_process.spawn`'s `cwd` option — there is no `--cwd` CLI flag.
  
  - adapter-hermes: adds a `cwd: string | null` constructor option, a required
    `cwd` field on `SpawnArgs`, and forwards it through `defaultSpawn`. `send`
    now pins the resume spawn to `ref.meta.cwd` (falling back to the resolved
    default for legacy hand-built refs), fixing #66 where resumes inherited the
    server's `process.cwd()`.
  - adapter-claude-code: adds the Case-4 non-string rejection (#54); the
    existing per-call/constructor/`process.cwd()` resolution is unchanged.
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
- Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

