# Changelog

## 0.2.0 — 2026-06-26

- Add OpenAI Codex CLI adapter (@sumeru/adapter-codex) with support for session resume via `codex exec resume`. The adapter spawns `codex exec --json` for structured JSONL output parsing, with configurable flags for `--dangerously-bypass-approvals-and-sandbox` and `--skip-git-repo-check` for unattended operation.
- feat: migrate CLI from commander to @ocas/cli-kit
  
  Migrate the sumeru CLI to use `@ocas/cli-kit` for schema-driven command
  building and output validation. This is the fourth project to adopt cli-kit
  (after ocas, proman, and gangmu).
  
  Changes:
  - `commander` → `createCLI()` builder pattern
  - Zod schemas for structured output validation
  - Early `--help`/`--version` interception (cli-kit workaround, see ocas#230)
  - Per-command `--help` text for `start` and `run`
  - Short flag aliases (`-c`) defined as separate flags (cli-kit workaround)
  - `start` command bypasses cli-kit output system: uses `process.stdout/stderr`
    directly + `process.exit()` to preserve exact output format for e2e tests
  - All existing functionality preserved: `--emit-assets`, docker dispatch,
    PID file lifecycle, port retry, graceful shutdown
  - `run` command: `--image`/`-i` flag removed (issue #85), `--no-network`
    added as separate flag (cli-kit workaround)
  - Deleted local `packages/cli-kit/` (old 0.1.0 copy, superseded by npm)
  - Bumped `@shazhou/proman` devDep to ^0.11.0
  
  Refs: ocas#230 (cli-kit missing features)
- Docker foundation toolchain baseline (#102, RFC #99 P0): upgrade the packaged
  runtime image from a thin base to a full workshop foundation.
  
  The shipped `packages/server/templates/docker/Dockerfile` now installs, all at
  build time as root, before the non-root `USER` switch:
  
  - **build-essential** — so a sandboxed agent can source-compile native
    extensions (numpy / lxml / cffi …) at run time with no apt and no supervisor.
  - **uv** — Python multi-version + venv + installer; default **Python 3.12**
    installed into a shared, uid-10001-owned tree and symlinked onto `PATH` so a
    bare non-login `python` resolves. Agents add 3.11 / 3.13 / … on demand.
  - **nvm** — Node multi-version in the shared `/usr/local/nvm`; default
    **Node 24 LTS** (pinned by major: `nvm install 24`, not an LTS codename). The
    default Node 24 bin is prepended onto the base `PATH` via `ENV` so a bare,
    non-login `node` — the shape an adapter `spawn`s — lands on v24, not the
    `node:22-slim` base interpreter. The nvm tree is uid-10001-owned so agents
    `nvm install <ver>` more lines at run time.
  
  The pnpm-store, uv, and nvm downloads ride BuildKit `--mount=type=cache`
  (build-time only — no final image layer, zero run-time / isolation effect).
  
  Two-layer model is unchanged: every toolchain install is build-time root; the
  container still RUNS as the fixed non-root **uid 10001**. The change is purely
  additive — self-containment (no source COPY), the ocas pre-create, the uid /
  home / port model, and the HTTP/SSE contract are all untouched. The server's own
  install (pnpm-global `@sumeru/cli`) stays reproducible and independent of the
  nvm dynamic layer; running the server under Node 24 is safe because Sumeru has
  no native-ABI dependency (its only persistence driver is the built-in
  `node:sqlite`, and the rest of the tree — `@ocas/*`, `ajv`, `yaml` — is pure JS).
  
  Tests: a new `SUMERU_DOCKER_INTEGRATION`-gated suite
  (`packages/server/tests/docker-toolchain.test.ts`) — non-gated content
  assertions on the Dockerfile (run in CI) plus gated real build / run probes
  (default python 3.12 + node 24 incl. the non-login spawn shape, uv/nvm
  multi-version switch, non-root native compile, uid 10001, server geo-layer
  intact). The gate keeps CI green (skipped, never failed, no `docker` at import).
  The `@sumeru/cli` bump is the test-only follow-through: the existing gated
  `docker-mode.test.ts` default-`node` assertion moves v22 → v24 to match the new
  image default.
  
  Specs: new `specs/deploy/docker-toolchain-baseline.md` (behavior contract);
  `specs/architecture/docker-mode.md` 「镜像内容契约」 table gains the foundation
  toolchain + version/package-split rows and the default-node assertion updates to
  v24. The run-time unit-internal cache volume (RFC #99 cache档1) is deferred to a
  follow-up issue as a compose-template concern orthogonal to this Dockerfile
  baseline.
  
  Ref #102 #99.
- Wire `@sumeru/adapter-cursor-agent` into the CLI adapter factory so `sumeru.yaml` gateways with `adapter: cursor-agent` are registered instead of reporting `status: "unavailable"`.
- Docker Phase 2 (#85): `sumeru start -c <config>` dispatches on `deploy.mode`.
  
  - `deploy.mode: docker` launches `docker compose -p <name> up -d --build` (thin
    wrapper, identity via `-p <name>`, `~` expansion, reuse-don't-clobber template
    materialization); `local`/absent falls through to the existing local path
    (zero regression).
  - `--emit-assets` releases the compose templates next to the config and exits.
  - No-Docker downgrade: a `docker` config on a Docker-less host exits 1 with a
    single-line message, no stack trace, no fallback.
  - Removes the legacy `-i, --image` flag from `run` (superseded by `deploy.image`).
  - Fixes two Docker image template bugs surfaced by Phase 2's real `up` (Phase 1
    only built the old COPY image): pnpm global-bin PATH must be `$PNPM_HOME/bin`
    (else `pnpm add -g` refuses), and `/data/ocas` must be pre-created + chowned to
    the non-root `sumeru` user (else the fresh named volume lands root:root and the
    server crash-loops on "unable to open database file").
- Docker Phase 3 (#86): gated integration suite + README.
  
  Adds `packages/cli/tests/docker-mode.test.ts`, a `SUMERU_DOCKER_INTEGRATION`-gated
  suite that drives the real Docker backend end-to-end (build / self-contained
  image, start + health, SSE round-trip, ocas persistence across `down`,
  multi-unit isolation, deterministic export, non-fatal gateway degradation,
  no-Docker downgrade). The gate keeps CI green — with the env var unset the suite
  skips and touches no Docker at import. A test-only `tests/helpers/docker.ts`
  bundles the runners, health poll, deterministic fake-`hermes` seam (no LLM /
  creds / network), and a built-in tar/gzip export decoder.
  
  README's 部署 chapter's 「Docker 模式」 subsection is corrected — the stale Phase 1
  "统一入口在后续阶段接入" note is replaced with the shipped `sumeru start -c <config>`
  launch path plus the two operator guarantees (named-volume persistence; one
  config = one isolated work unit).
  
  The gateway-degradation case asserts the real contract — `GET /gateways` status
  is keyed on adapter-name registration, not a runtime binary probe, so a bundled
  `claude-code` with no `claude` binary stays `ready` while an unknown adapter is
  `unavailable` — documented in `specs/integration/docker-gateway-status-semantics.md`,
  with the aspirational binary-probe enhancement tracked in #93.
  
  Test + docs only; no shipped behavior change.
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
- fix: graceful shutdown, port-conflict diagnostics, and PID file lifecycle for `sumeru start` (#33)
  
  `sumeru start` now handles the full process lifecycle correctly:
  
  - **Graceful shutdown** — `SIGTERM`/`SIGINT` log `[sumeru] shutting down (<signal>)…`,
    await `server.stop()`, remove the PID file, and exit `0`. A second signal forces
    exit (`130`/`143`) so a hung shutdown is always escapable.
  - **Port-conflict diagnostics** — when the bind port is already held, the CLI
    shells out to `lsof` to identify the holder and prints
    `Held by pid <PID> (<command>)` plus a hint to use `--force`. Falls back
    gracefully if `lsof` is missing.
  - **`--force` flag** — sends `SIGTERM` to the holder, waits 2s for the port to
    free, then sends `SIGKILL`, then proceeds with startup.
  - **PID file** — written to `~/.sumeru/sumeru.pid` (mode `0o600`, dir `0o700`)
    before bind; removed on graceful shutdown. A stale PID file (process dead) is
    silently overwritten; a live PID file blocks the new start unless `--force`
    is passed. Override via `SUMERU_PID_FILE` for tests.
  
  Two new modules: `packages/cli/src/pid-file.ts` and
  `packages/cli/src/port-check.ts`. PID file writes are best-effort — a
  read-only home directory degrades to a warning and Sumeru still starts.
  
  Fixes #33.
- Parse the optional top-level `deploy:` block of `sumeru.yaml` (issue #84,
  Phase 1).
  
  New CLI-side module `packages/cli/src/deploy-config.ts` exports
  `loadDeployConfig(path): Promise<DeployConfig>`, where:
  
  ```typescript
  type DeployConfig = {
    mode: "docker" | "local";  // absent → "local"
    port: number | null;       // host port; absent → null
    workspace: string | null;  // host workdir; absent / "" → null
    image: string | null;      // image tag; absent / "" → null
  };
  ```
  
  The parser is a pure structural reader: it stores `workspace` verbatim (no `~`
  expansion), folds empty-string `workspace` / `image` to `null`, and does NOT
  bake in the `7900` port or `sumeru:latest` image defaults — those belong to the
  compose template's `${VAR:-default}` interpolation. Malformed input throws an
  `Error` naming the offending field (`deploy.mode` / `deploy.port` / `deploy`),
  the offending value, and the source path.
  
  `@sumeru/server`'s `loadConfig` is unchanged — `deploy` remains an unknown
  top-level key that the existing forward-compat tolerance silently ignores, so
  the server runtime never sees deployment metadata.
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
- Phase 0: scaffold `@sumeru/server` package and add `sumeru start` CLI subcommand.
  
  - New `@sumeru/server` package: minimal HTTP service using `node:http`.
  - `GET /` returns the ocas envelope `{ type: "@sumeru/instance", value: { name, version, gateways: [] } }`.
  - Unknown paths return `404` with the `@sumeru/error` envelope; `POST /` returns `405` with `Allow: GET`.
  - New `sumeru start` CLI subcommand with `--port` (default `7900`, `0` = ephemeral) and `--host` (default `127.0.0.1`).
  - Clean `EADDRINUSE` error messages and graceful `SIGINT` shutdown.
- Phase 1: configuration loading + read-only gateway endpoints.
  
  - New `loadConfig(path)` in `@sumeru/server` parses `sumeru.yaml` into a typed
    `InstanceConfig` (`name`, `gateways: Record<string, GatewayConfig>`).
  - `@sumeru/server` now takes `gateways` in `StartConfig` / `ServerConfig`.
  - `GET /` returns `@sumeru/instance` with `value.name` from the YAML and
    `value.gateways` as an ordered array of gateway names.
  - New `GET /gateways` endpoint returns `@sumeru/gateway-list` envelope with
    every configured gateway (`name`, `adapter`, `status`, `activeSessions`,
    `capabilities`). Status is `"ready"` and `activeSessions` is `0` in Phase 1.
  - New `GET /gateways/:name` endpoint returns `@sumeru/gateway` envelope, or a
    `404 @sumeru/error` envelope with `error: "gateway_not_found"` (distinct from
    the generic `not_found` for unknown paths).
  - `POST` on `/gateways` and `/gateways/:name` returns `405 + Allow: GET` with a
    `@sumeru/error` envelope.
  - `sumeru start` gains a `-c, --config <path>` option. Bad/missing config files
    cause a clear stderr message and exit non-zero before binding a port.
  - All response bodies — including 404 and 405 — use the `{ type, value }` ocas
    envelope; no plain text or stack traces leak.

## 0.2.0 — 2026-06-26

- Add OpenAI Codex CLI adapter (@sumeru/adapter-codex) with support for session resume via `codex exec resume`. The adapter spawns `codex exec --json` for structured JSONL output parsing, with configurable flags for `--dangerously-bypass-approvals-and-sandbox` and `--skip-git-repo-check` for unattended operation.
- feat: migrate CLI from commander to @ocas/cli-kit
  
  Migrate the sumeru CLI to use `@ocas/cli-kit` for schema-driven command
  building and output validation. This is the fourth project to adopt cli-kit
  (after ocas, proman, and gangmu).
  
  Changes:
  - `commander` → `createCLI()` builder pattern
  - Zod schemas for structured output validation
  - Early `--help`/`--version` interception (cli-kit workaround, see ocas#230)
  - Per-command `--help` text for `start` and `run`
  - Short flag aliases (`-c`) defined as separate flags (cli-kit workaround)
  - `start` command bypasses cli-kit output system: uses `process.stdout/stderr`
    directly + `process.exit()` to preserve exact output format for e2e tests
  - All existing functionality preserved: `--emit-assets`, docker dispatch,
    PID file lifecycle, port retry, graceful shutdown
  - `run` command: `--image`/`-i` flag removed (issue #85), `--no-network`
    added as separate flag (cli-kit workaround)
  - Deleted local `packages/cli-kit/` (old 0.1.0 copy, superseded by npm)
  - Bumped `@shazhou/proman` devDep to ^0.11.0
  
  Refs: ocas#230 (cli-kit missing features)
- Docker foundation toolchain baseline (#102, RFC #99 P0): upgrade the packaged
  runtime image from a thin base to a full workshop foundation.
  
  The shipped `packages/server/templates/docker/Dockerfile` now installs, all at
  build time as root, before the non-root `USER` switch:
  
  - **build-essential** — so a sandboxed agent can source-compile native
    extensions (numpy / lxml / cffi …) at run time with no apt and no supervisor.
  - **uv** — Python multi-version + venv + installer; default **Python 3.12**
    installed into a shared, uid-10001-owned tree and symlinked onto `PATH` so a
    bare non-login `python` resolves. Agents add 3.11 / 3.13 / … on demand.
  - **nvm** — Node multi-version in the shared `/usr/local/nvm`; default
    **Node 24 LTS** (pinned by major: `nvm install 24`, not an LTS codename). The
    default Node 24 bin is prepended onto the base `PATH` via `ENV` so a bare,
    non-login `node` — the shape an adapter `spawn`s — lands on v24, not the
    `node:22-slim` base interpreter. The nvm tree is uid-10001-owned so agents
    `nvm install <ver>` more lines at run time.
  
  The pnpm-store, uv, and nvm downloads ride BuildKit `--mount=type=cache`
  (build-time only — no final image layer, zero run-time / isolation effect).
  
  Two-layer model is unchanged: every toolchain install is build-time root; the
  container still RUNS as the fixed non-root **uid 10001**. The change is purely
  additive — self-containment (no source COPY), the ocas pre-create, the uid /
  home / port model, and the HTTP/SSE contract are all untouched. The server's own
  install (pnpm-global `@sumeru/cli`) stays reproducible and independent of the
  nvm dynamic layer; running the server under Node 24 is safe because Sumeru has
  no native-ABI dependency (its only persistence driver is the built-in
  `node:sqlite`, and the rest of the tree — `@ocas/*`, `ajv`, `yaml` — is pure JS).
  
  Tests: a new `SUMERU_DOCKER_INTEGRATION`-gated suite
  (`packages/server/tests/docker-toolchain.test.ts`) — non-gated content
  assertions on the Dockerfile (run in CI) plus gated real build / run probes
  (default python 3.12 + node 24 incl. the non-login spawn shape, uv/nvm
  multi-version switch, non-root native compile, uid 10001, server geo-layer
  intact). The gate keeps CI green (skipped, never failed, no `docker` at import).
  The `@sumeru/cli` bump is the test-only follow-through: the existing gated
  `docker-mode.test.ts` default-`node` assertion moves v22 → v24 to match the new
  image default.
  
  Specs: new `specs/deploy/docker-toolchain-baseline.md` (behavior contract);
  `specs/architecture/docker-mode.md` 「镜像内容契约」 table gains the foundation
  toolchain + version/package-split rows and the default-node assertion updates to
  v24. The run-time unit-internal cache volume (RFC #99 cache档1) is deferred to a
  follow-up issue as a compose-template concern orthogonal to this Dockerfile
  baseline.
  
  Ref #102 #99.
- Wire `@sumeru/adapter-cursor-agent` into the CLI adapter factory so `sumeru.yaml` gateways with `adapter: cursor-agent` are registered instead of reporting `status: "unavailable"`.
- Docker Phase 2 (#85): `sumeru start -c <config>` dispatches on `deploy.mode`.
  
  - `deploy.mode: docker` launches `docker compose -p <name> up -d --build` (thin
    wrapper, identity via `-p <name>`, `~` expansion, reuse-don't-clobber template
    materialization); `local`/absent falls through to the existing local path
    (zero regression).
  - `--emit-assets` releases the compose templates next to the config and exits.
  - No-Docker downgrade: a `docker` config on a Docker-less host exits 1 with a
    single-line message, no stack trace, no fallback.
  - Removes the legacy `-i, --image` flag from `run` (superseded by `deploy.image`).
  - Fixes two Docker image template bugs surfaced by Phase 2's real `up` (Phase 1
    only built the old COPY image): pnpm global-bin PATH must be `$PNPM_HOME/bin`
    (else `pnpm add -g` refuses), and `/data/ocas` must be pre-created + chowned to
    the non-root `sumeru` user (else the fresh named volume lands root:root and the
    server crash-loops on "unable to open database file").
- Docker Phase 3 (#86): gated integration suite + README.
  
  Adds `packages/cli/tests/docker-mode.test.ts`, a `SUMERU_DOCKER_INTEGRATION`-gated
  suite that drives the real Docker backend end-to-end (build / self-contained
  image, start + health, SSE round-trip, ocas persistence across `down`,
  multi-unit isolation, deterministic export, non-fatal gateway degradation,
  no-Docker downgrade). The gate keeps CI green — with the env var unset the suite
  skips and touches no Docker at import. A test-only `tests/helpers/docker.ts`
  bundles the runners, health poll, deterministic fake-`hermes` seam (no LLM /
  creds / network), and a built-in tar/gzip export decoder.
  
  README's 部署 chapter's 「Docker 模式」 subsection is corrected — the stale Phase 1
  "统一入口在后续阶段接入" note is replaced with the shipped `sumeru start -c <config>`
  launch path plus the two operator guarantees (named-volume persistence; one
  config = one isolated work unit).
  
  The gateway-degradation case asserts the real contract — `GET /gateways` status
  is keyed on adapter-name registration, not a runtime binary probe, so a bundled
  `claude-code` with no `claude` binary stays `ready` while an unknown adapter is
  `unavailable` — documented in `specs/integration/docker-gateway-status-semantics.md`,
  with the aspirational binary-probe enhancement tracked in #93.
  
  Test + docs only; no shipped behavior change.
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
- fix: graceful shutdown, port-conflict diagnostics, and PID file lifecycle for `sumeru start` (#33)
  
  `sumeru start` now handles the full process lifecycle correctly:
  
  - **Graceful shutdown** — `SIGTERM`/`SIGINT` log `[sumeru] shutting down (<signal>)…`,
    await `server.stop()`, remove the PID file, and exit `0`. A second signal forces
    exit (`130`/`143`) so a hung shutdown is always escapable.
  - **Port-conflict diagnostics** — when the bind port is already held, the CLI
    shells out to `lsof` to identify the holder and prints
    `Held by pid <PID> (<command>)` plus a hint to use `--force`. Falls back
    gracefully if `lsof` is missing.
  - **`--force` flag** — sends `SIGTERM` to the holder, waits 2s for the port to
    free, then sends `SIGKILL`, then proceeds with startup.
  - **PID file** — written to `~/.sumeru/sumeru.pid` (mode `0o600`, dir `0o700`)
    before bind; removed on graceful shutdown. A stale PID file (process dead) is
    silently overwritten; a live PID file blocks the new start unless `--force`
    is passed. Override via `SUMERU_PID_FILE` for tests.
  
  Two new modules: `packages/cli/src/pid-file.ts` and
  `packages/cli/src/port-check.ts`. PID file writes are best-effort — a
  read-only home directory degrades to a warning and Sumeru still starts.
  
  Fixes #33.
- Parse the optional top-level `deploy:` block of `sumeru.yaml` (issue #84,
  Phase 1).
  
  New CLI-side module `packages/cli/src/deploy-config.ts` exports
  `loadDeployConfig(path): Promise<DeployConfig>`, where:
  
  ```typescript
  type DeployConfig = {
    mode: "docker" | "local";  // absent → "local"
    port: number | null;       // host port; absent → null
    workspace: string | null;  // host workdir; absent / "" → null
    image: string | null;      // image tag; absent / "" → null
  };
  ```
  
  The parser is a pure structural reader: it stores `workspace` verbatim (no `~`
  expansion), folds empty-string `workspace` / `image` to `null`, and does NOT
  bake in the `7900` port or `sumeru:latest` image defaults — those belong to the
  compose template's `${VAR:-default}` interpolation. Malformed input throws an
  `Error` naming the offending field (`deploy.mode` / `deploy.port` / `deploy`),
  the offending value, and the source path.
  
  `@sumeru/server`'s `loadConfig` is unchanged — `deploy` remains an unknown
  top-level key that the existing forward-compat tolerance silently ignores, so
  the server runtime never sees deployment metadata.
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
- Phase 0: scaffold `@sumeru/server` package and add `sumeru start` CLI subcommand.
  
  - New `@sumeru/server` package: minimal HTTP service using `node:http`.
  - `GET /` returns the ocas envelope `{ type: "@sumeru/instance", value: { name, version, gateways: [] } }`.
  - Unknown paths return `404` with the `@sumeru/error` envelope; `POST /` returns `405` with `Allow: GET`.
  - New `sumeru start` CLI subcommand with `--port` (default `7900`, `0` = ephemeral) and `--host` (default `127.0.0.1`).
  - Clean `EADDRINUSE` error messages and graceful `SIGINT` shutdown.
- Phase 1: configuration loading + read-only gateway endpoints.
  
  - New `loadConfig(path)` in `@sumeru/server` parses `sumeru.yaml` into a typed
    `InstanceConfig` (`name`, `gateways: Record<string, GatewayConfig>`).
  - `@sumeru/server` now takes `gateways` in `StartConfig` / `ServerConfig`.
  - `GET /` returns `@sumeru/instance` with `value.name` from the YAML and
    `value.gateways` as an ordered array of gateway names.
  - New `GET /gateways` endpoint returns `@sumeru/gateway-list` envelope with
    every configured gateway (`name`, `adapter`, `status`, `activeSessions`,
    `capabilities`). Status is `"ready"` and `activeSessions` is `0` in Phase 1.
  - New `GET /gateways/:name` endpoint returns `@sumeru/gateway` envelope, or a
    `404 @sumeru/error` envelope with `error: "gateway_not_found"` (distinct from
    the generic `not_found` for unknown paths).
  - `POST` on `/gateways` and `/gateways/:name` returns `405 + Allow: GET` with a
    `@sumeru/error` envelope.
  - `sumeru start` gains a `-c, --config <path>` option. Bad/missing config files
    cause a clear stderr message and exit non-zero before binding a port.
  - All response bodies — including 404 and 405 — use the `{ type, value }` ocas
    envelope; no plain text or stack traces leak.

