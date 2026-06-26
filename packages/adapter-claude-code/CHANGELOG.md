# Changelog

## 0.2.0 — 2026-06-26

- Add Claude Code adapter (`@sumeru/adapter-claude-code`). Spawns `claude` CLI with stream-JSON output, parses NDJSON turns, supports resume. Widen `ToolCall.output` and `ToolCall.durationMs` in core types. Update server schema registry.
- fix: make adapter timeouts (and any adapter option) configurable from `sumeru.yaml`, raise claude-code default `sendTimeoutMs` to 30 min
  
  Adds an optional `config:` block per gateway in `sumeru.yaml`. The block is
  parsed verbatim by `@sumeru/server`'s YAML loader (rejecting non-mapping
  shapes with errors that name path / gateway / field) and forwarded by
  `@sumeru/cli` to the matching adapter factory at boot. The claude-code
  adapter consumes `sendTimeoutMs`, `createSessionTimeoutMs`, `maxTurns`,
  `model`, `claudeBin`, and `cwd` directly from this blob — the old
  hard-coded 10-minute send timeout was killing long-running solve-issue
  runs (15-25 min). Default raised to 30 min; operators can still override
  both directions via the YAML.
  
  ```yaml
  gateways:
    claude-code:
      adapter: claude-code
      config:
        sendTimeoutMs: 1800000        # 30 min
        createSessionTimeoutMs: 300000 # 5 min
        maxTurns: 120
      capabilities:
        resume: true
        streaming: true
  ```
  
  No-config YAML keeps booting byte-identically — the loader emits
  `config: null` and the CLI forwards `{}` to factories.
  
  Fixes #32.
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
- Implement true incremental streaming for all NDJSON adapters (Fixes #77)
  
  Add `defaultStreamingSpawn` (returns `{lines, waitForExit()}` synchronously) and `parseStreamJsonIncremental` / `parseCodexJsonIncremental` async generators. Rewrite `send()` to yield turn events as each line is parsed from stdout — before the child process exits — with immediate turnsCache updates. Tool-result events fill in `ToolCall.output` on previously-yielded Turn objects via reference sharing.
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
- Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

## 1.0.0 — 2026-06-26

- Add Claude Code adapter (`@sumeru/adapter-claude-code`). Spawns `claude` CLI with stream-JSON output, parses NDJSON turns, supports resume. Widen `ToolCall.output` and `ToolCall.durationMs` in core types. Update server schema registry.
- fix: make adapter timeouts (and any adapter option) configurable from `sumeru.yaml`, raise claude-code default `sendTimeoutMs` to 30 min
  
  Adds an optional `config:` block per gateway in `sumeru.yaml`. The block is
  parsed verbatim by `@sumeru/server`'s YAML loader (rejecting non-mapping
  shapes with errors that name path / gateway / field) and forwarded by
  `@sumeru/cli` to the matching adapter factory at boot. The claude-code
  adapter consumes `sendTimeoutMs`, `createSessionTimeoutMs`, `maxTurns`,
  `model`, `claudeBin`, and `cwd` directly from this blob — the old
  hard-coded 10-minute send timeout was killing long-running solve-issue
  runs (15-25 min). Default raised to 30 min; operators can still override
  both directions via the YAML.
  
  ```yaml
  gateways:
    claude-code:
      adapter: claude-code
      config:
        sendTimeoutMs: 1800000        # 30 min
        createSessionTimeoutMs: 300000 # 5 min
        maxTurns: 120
      capabilities:
        resume: true
        streaming: true
  ```
  
  No-config YAML keeps booting byte-identically — the loader emits
  `config: null` and the CLI forwards `{}` to factories.
  
  Fixes #32.
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
- Implement true incremental streaming for all NDJSON adapters (Fixes #77)
  
  Add `defaultStreamingSpawn` (returns `{lines, waitForExit()}` synchronously) and `parseStreamJsonIncremental` / `parseCodexJsonIncremental` async generators. Rewrite `send()` to yield turn events as each line is parsed from stdout — before the child process exits — with immediate turnsCache updates. Tool-result events fill in `ToolCall.output` on previously-yielded Turn objects via reference sharing.
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
- Raise default `send` timeout to 2 hours across all four adapters (was 5 min hermes / 30 min claude-code & codex / 10 min cursor-agent). Long-running tasks (e.g. uwf solve-issue migrating a large CLI) were being killed mid-execution by the previous limits (#92). The timeout is kept finite — not null — on purpose: it doubles as a wedged-process detector that #95 (timeout-as-suspend) will reuse to turn a timeout into a resumable suspend rather than a hard failure. Operators can still override per-gateway via `sumeru.yaml`.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

