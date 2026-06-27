# Changelog

## 0.2.0 — 2026-06-26

- Add Claude Code adapter (`@sumeru/adapter-claude-code`). Spawns `claude` CLI with stream-JSON output, parses NDJSON turns, supports resume. Widen `ToolCall.output` and `ToolCall.durationMs` in core types. Update server schema registry.
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
- fix: disable Nagle's algorithm on SSE responses so events flush immediately
  
  Without `socket.setNoDelay(true)`, heartbeats, turn events, and done events
  written via `res.write()` were buffered by the TCP stack and never reached the
  client. This caused the broker's SSE consumer (`consumeSse`) to block
  indefinitely on `reader.read()`, making the entire broker → Sumeru → agent
  pipeline hang.
  
  Fixes #30.
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
- Add Phase-3 supersede note to DELETE session endpoint spec documenting that the implementation now calls adapter.close() as a forward-compatible enhancement (Fixes #60)
- Align turn schema spec with implementation: `toolCalls[].output` and `toolCalls[].durationMs` now document `null` as a valid value (anyOf null/string and null/integer respectively), matching the existing code in `packages/server/src/ocas/schemas.ts`.
- Export `SUMERU_TURN_SCHEMA_HASH` and `SUMERU_SESSION_META_SCHEMA_HASH` as named constants from `@sumeru/server`, enabling static imports without booting a full ocas store. Fixes #62.
- Update session-meta spec to document resolvedCwd as the 6th required field (added in phase-6)
- Add Docker-mode orchestration assets (issue #84, Phase 1).
  
  `@sumeru/server` now ships three literal templates under
  `packages/server/templates/docker/` and exports a primitive to release them:
  
  - `Dockerfile` — self-contained Node 22 image that installs Sumeru from npm
    (`pnpm add -g @sumeru/cli@${SUMERU_VERSION}`), carries no source `COPY`, and
    runs as a non-root `sumeru` user (fixed uid 10001), `EXPOSE 7900`.
  - `docker-compose.yaml` — zero-render compose file driven entirely by
    compose-native `${VAR:-default}` interpolation: host-port mapping, the three
    mounts (named `sumeru-ocas` volume, `WORKSPACE` bind, read-only config), an
    optional `env_file` (`required: false`), and a curl healthcheck.
  - `sumeru.env.example` — placeholder adapter credentials (`ANTHROPIC_API_KEY` /
    `ANTHROPIC_BASE_URL`), mirroring `deploy/sumeru.env.example`.
  
  `materializeDockerAssets(targetDir: string): string[]` copies the three
  templates byte-for-byte (no string rendering) into `targetDir`, resolving the
  source directory relative to the compiled module location (not `process.cwd()`)
  so it works from a globally-installed `@sumeru/cli`. It creates `targetDir`
  recursively, is idempotent, and returns the written paths in stable order.
  
  The package's `files` array now includes `"templates"` so the assets publish to
  npm. The templates live outside `rootDir: src`, so `tsc` neither compiles nor
  emits them.
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
- Fix SSE resume returning 404 instead of 410 for expired buffers
  
  When a client attempts to resume an SSE stream (via Last-Event-ID) after the
  buffer retention window (30s), the server now returns `410 Gone` with error
  `stream_expired` instead of `404` with `no_event_buffer`. This allows clients
  to distinguish "the stream existed but expired" from "no stream was ever
  created for this session".
  
  Implementation adds a bounded ghost set to `SseBufferStore` that tracks
  recently-expired session keys. The ghost set is pruned on each `purgeExpired`
  call after `retentionMs`, preventing unbounded growth.
  
  Fixes #58
- Add per-gateway startup logging. After the ocas store line, startServer now prints one line per gateway showing adapter resolution status: `[sumeru] gateway <name> -> adapter @sumeru/adapter-<name> (ready|unavailable: not registered)`.
- Persist session `turnHashes` across server restart (Refs #399).
  
  Previously the ordered per-session turn-list pointer (`Session.turnHashes`)
  was an in-memory-only array: although every turn's CONTENT was already
  durable in ocas, the LIST was rebuilt empty on every boot, so after a
  restart `GET /gateways/:name/sessions/:id/messages` returned `total: 0` for
  previously-recorded sessions. The turn history was silently lost.
  
  - New `sumeru_session_turns(session_id, turn_index, turn_hash,
    PRIMARY KEY (session_id, turn_index))` table in the existing
    `<ocasDir>/_store.db` (sibling to the FTS5 tables — no new storage
    dependency, no second DB handle). `SessionStore.appendTurnHash` now
    persists one idempotent row (`ON CONFLICT DO NOTHING`) at the 0-based
    append position synchronously, BEFORE mutating the in-memory array, so
    disk never lags memory. The table is never cleared by the FTS `rebuild()`
    path, so the turn-list pointer is durable independent of search re-indexing.
  - New nullable `meta_hash` column on `sumeru_session_index` (added on fresh
    DBs via the `CREATE TABLE` DDL, and on legacy DBs via a pragma-guarded
    `ALTER TABLE … ADD COLUMN` migration inside the existing boot transaction).
    `indexSessionMeta` persists it so a restart can recover each session's
    opaque `config` from the immutable `@sumeru/session-meta` node.
    `SessionMetaInput` gains a required `metaHash: Hash | null` field.
  - `createSessionStore` now rehydrates `byGateway` from disk on construction,
    BEFORE serving any request: it reads `sumeru_session_index` (ordered by
    `created_at ASC`) and bulk-loads every session's ordered turn hashes in a
    single query. A closed session restores as `closed`; an idle/active session
    restores as `idle` (a restart can never leave a send mid-flight, so the
    transient `active` state normalizes to `idle`). When a session's `meta_hash`
    is `null` or its meta node is unreadable, `config` falls back to `{}` with a
    structured `[sumeru]` warning — turn history is the priority. Boot emits one
    `[sumeru] rehydrated <S> sessions, <T> turns` line.
  - New `SearchIndex` methods (closure over the single existing `DatabaseSync`
    handle): `appendSessionTurn`, `listSessionTurns`, `loadSessionTurnsBulk`,
    `loadSessionRows`. `PersistedSessionRow` type exported.
  - Documented non-goal: the adapter-side `NativeSessionRef` is live runtime
    state and is NOT persisted. A rehydrated session is read-complete (history
    works fully) but not resumable for new sends — `POST .../messages` hits the
    existing `nativeRef === null` branch and returns `503 adapter_unavailable`.
    The message endpoint surfaces any turn-list persistence failure as
    `turn_persist_failed` (clean 500 before the stream for the user turn; an
    in-stream `event: error` for assistant turns) rather than silently diverging
    memory from disk.
  
  The HTTP wire shapes are byte-identical; the only observable change is that
  turn history now survives a server restart.
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
- Phase 5: session search + export.
  
  - New SQLite FTS5 search index (`packages/server/src/search/`) backed by a
    second `node:sqlite` handle on `<ocasDir>/_store.db` — the same file
    `@ocas/fs` uses for vars/tags. Schema is bootstrapped on first open via
    `createSearchIndex(dbPath)`. Tables: `sumeru_turn_index` (one row per
    turn), contentless `sumeru_turn_fts` (FTS5 with `unicode61` tokenizer
    for CJK), and `sumeru_session_index` (per-session denormalized state).
    AFTER INSERT/DELETE triggers keep the FTS5 mirror in lockstep with the
    index table. All indexing paths are idempotent on the turn hash /
    session id, so re-indexing is a no-op.
  - `openSumeruOcas(dir)` now also opens the search index; `SumeruOcas`
    exposes `searchIndex: SearchIndex` alongside the store. Session
    create/close and turn write paths transparently feed the index — no
    caller changes required for Phase 1-4 code.
  - New endpoint `GET /sessions?q=<query>` performs cross-gateway search;
    `GET /gateways/:name/sessions?q=<query>` extends the Phase 2 list
    endpoint with per-gateway search. Both return a
    `@sumeru/search-result` envelope `{ query, gateway, total, offset,
    limit, results: SearchResultHit[] }` ordered by BM25 (best first).
    Supports `?gateway=<name>`, `?limit` (default 50, cap 100), `?offset`
    (default 0). Empty/whitespace `q` on top-level → `400 invalid_request`;
    on per-gateway → falls through to the existing Phase 2 session list.
    Each hit carries `relevance` normalized to `(0, 1]` via
    `1 / (1 + |bm25|)` and a `matchContext` snippet with `<<...>>` markers.
  - New endpoint `POST /gateways/:name/sessions/:id/export` returns the
    session's full recording (session-meta + every turn + their schema
    chain) as a self-contained `tar.gz`, built via
    `@ocas/core.exportBundle`. Headers: `Content-Type: application/gzip`,
    `Content-Disposition: attachment; filename="<sessionId>.tar.gz"`,
    `Cache-Control: no-store`, `X-Sumeru-Export-Nodes`,
    `X-Sumeru-Export-Session`, `Content-Length`. NO `Content-Encoding`
    (gzip is the payload format, not transport encoding). Closed and
    empty sessions are exportable. `HEAD` returns the same headers with
    an empty body. Temp-dir cleanup runs on response `finish` AND `close`,
    so client disconnects do not leak.
  - `quoteFtsPhrase(raw)`, `searchSessions(index, opts)`, and
    `rebuildSearchIndex(index, ocas, roots)` are exported from
    `@sumeru/server` for tooling and tests.
  - `README.md` HTTP table gains rows for the new search and export
    endpoints, and the Recording section gets a one-line note about
    `ocas import` round-tripping.
- CAS-backed SSE frame persistence + withResumable middleware (Phase A3, RFC #107)
- Make `rebuildSearchIndex` walk the ocas store via `listByType` instead of requiring callers to supply roots. The function now takes two arguments `(index, ocas)` — the third `roots` parameter is removed. Internally, the rebuild closure enumerates all `@sumeru/session-meta` and `@sumeru/turn` nodes by schema hash, uses `sumeru_session_turns` for turn→session association, and runs a corrective UPDATE to fix `turn_count`/`last_active_at`. Orphaned turns are skipped with a warn-level log.
  
  Fixes #59
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
- Phase 2: session lifecycle endpoints.
  
  - New `POST /gateways/:name/sessions` creates an in-memory session and returns
    a `@sumeru/session` envelope with HTTP 201. Session IDs are `ses_` + a
    26-character Crockford Base32 ULID, generated server-side. Client-supplied
    `id` fields in the request body are ignored.
  - The `config` field of the request body is treated as **opaque**: Sumeru
    passes it through verbatim (preserves unknown keys, never validates,
    normalizes, or renames). Empty/missing bodies are equivalent to `{}`.
    Malformed JSON returns `400 invalid_json`; a non-object `config` returns
    `400 invalid_request`.
  - New `GET /gateways/:name/sessions` returns a `@sumeru/session-list` envelope.
    Listings are scoped per gateway, ordered by creation, omit `config`, and
    **include closed sessions**.
  - New `GET /gateways/:name/sessions/:id` returns a full `@sumeru/session`
    envelope (including `config`). Lookups are scoped to the gateway: requesting
    a session under a different gateway returns `404 session_not_found`.
  - New `DELETE /gateways/:name/sessions/:id` flips the session's status to
    `closed` and returns `204 No Content`. Deletes are **idempotent** —
    re-closing a closed session is a 204 no-op. Closed sessions remain
    queryable (status `closed`) for inspection.
  - Status state machine: `idle → active → idle | closed`, with a typed
    `SessionStatus = "idle" | "active" | "closed"`. Helpers `tryActivate` and
    `markIdle` on the session store define the 409 `session_busy` contract for
    the future message endpoint (currently unit-tested via the helper).
  - `GET /gateways` and `GET /gateways/:name` now report `activeSessions` as the
    count of non-closed sessions on the gateway, replacing the Phase-1
    hard-coded `0`.
  - All Phase-2 success bodies are `{ type, value }` envelopes; all failures use
    `@sumeru/error` with stable codes (`gateway_not_found`, `session_not_found`,
    `invalid_json`, `invalid_request`, `method_not_allowed`, `session_busy`).
    Method mismatches return 405 with a populated `Allow` header.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

## 1.0.0 — 2026-06-26

- Add Claude Code adapter (`@sumeru/adapter-claude-code`). Spawns `claude` CLI with stream-JSON output, parses NDJSON turns, supports resume. Widen `ToolCall.output` and `ToolCall.durationMs` in core types. Update server schema registry.
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
- fix: disable Nagle's algorithm on SSE responses so events flush immediately
  
  Without `socket.setNoDelay(true)`, heartbeats, turn events, and done events
  written via `res.write()` were buffered by the TCP stack and never reached the
  client. This caused the broker's SSE consumer (`consumeSse`) to block
  indefinitely on `reader.read()`, making the entire broker → Sumeru → agent
  pipeline hang.
  
  Fixes #30.
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
- Add Phase-3 supersede note to DELETE session endpoint spec documenting that the implementation now calls adapter.close() as a forward-compatible enhancement (Fixes #60)
- Align turn schema spec with implementation: `toolCalls[].output` and `toolCalls[].durationMs` now document `null` as a valid value (anyOf null/string and null/integer respectively), matching the existing code in `packages/server/src/ocas/schemas.ts`.
- Export `SUMERU_TURN_SCHEMA_HASH` and `SUMERU_SESSION_META_SCHEMA_HASH` as named constants from `@sumeru/server`, enabling static imports without booting a full ocas store. Fixes #62.
- Update session-meta spec to document resolvedCwd as the 6th required field (added in phase-6)
- Add Docker-mode orchestration assets (issue #84, Phase 1).
  
  `@sumeru/server` now ships three literal templates under
  `packages/server/templates/docker/` and exports a primitive to release them:
  
  - `Dockerfile` — self-contained Node 22 image that installs Sumeru from npm
    (`pnpm add -g @sumeru/cli@${SUMERU_VERSION}`), carries no source `COPY`, and
    runs as a non-root `sumeru` user (fixed uid 10001), `EXPOSE 7900`.
  - `docker-compose.yaml` — zero-render compose file driven entirely by
    compose-native `${VAR:-default}` interpolation: host-port mapping, the three
    mounts (named `sumeru-ocas` volume, `WORKSPACE` bind, read-only config), an
    optional `env_file` (`required: false`), and a curl healthcheck.
  - `sumeru.env.example` — placeholder adapter credentials (`ANTHROPIC_API_KEY` /
    `ANTHROPIC_BASE_URL`), mirroring `deploy/sumeru.env.example`.
  
  `materializeDockerAssets(targetDir: string): string[]` copies the three
  templates byte-for-byte (no string rendering) into `targetDir`, resolving the
  source directory relative to the compiled module location (not `process.cwd()`)
  so it works from a globally-installed `@sumeru/cli`. It creates `targetDir`
  recursively, is idempotent, and returns the written paths in stable order.
  
  The package's `files` array now includes `"templates"` so the assets publish to
  npm. The templates live outside `rootDir: src`, so `tsc` neither compiles nor
  emits them.
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
- Fix SSE resume returning 404 instead of 410 for expired buffers
  
  When a client attempts to resume an SSE stream (via Last-Event-ID) after the
  buffer retention window (30s), the server now returns `410 Gone` with error
  `stream_expired` instead of `404` with `no_event_buffer`. This allows clients
  to distinguish "the stream existed but expired" from "no stream was ever
  created for this session".
  
  Implementation adds a bounded ghost set to `SseBufferStore` that tracks
  recently-expired session keys. The ghost set is pruned on each `purgeExpired`
  call after `retentionMs`, preventing unbounded growth.
  
  Fixes #58
- Add per-gateway startup logging. After the ocas store line, startServer now prints one line per gateway showing adapter resolution status: `[sumeru] gateway <name> -> adapter @sumeru/adapter-<name> (ready|unavailable: not registered)`.
- Persist session `turnHashes` across server restart (Refs #399).
  
  Previously the ordered per-session turn-list pointer (`Session.turnHashes`)
  was an in-memory-only array: although every turn's CONTENT was already
  durable in ocas, the LIST was rebuilt empty on every boot, so after a
  restart `GET /gateways/:name/sessions/:id/messages` returned `total: 0` for
  previously-recorded sessions. The turn history was silently lost.
  
  - New `sumeru_session_turns(session_id, turn_index, turn_hash,
    PRIMARY KEY (session_id, turn_index))` table in the existing
    `<ocasDir>/_store.db` (sibling to the FTS5 tables — no new storage
    dependency, no second DB handle). `SessionStore.appendTurnHash` now
    persists one idempotent row (`ON CONFLICT DO NOTHING`) at the 0-based
    append position synchronously, BEFORE mutating the in-memory array, so
    disk never lags memory. The table is never cleared by the FTS `rebuild()`
    path, so the turn-list pointer is durable independent of search re-indexing.
  - New nullable `meta_hash` column on `sumeru_session_index` (added on fresh
    DBs via the `CREATE TABLE` DDL, and on legacy DBs via a pragma-guarded
    `ALTER TABLE … ADD COLUMN` migration inside the existing boot transaction).
    `indexSessionMeta` persists it so a restart can recover each session's
    opaque `config` from the immutable `@sumeru/session-meta` node.
    `SessionMetaInput` gains a required `metaHash: Hash | null` field.
  - `createSessionStore` now rehydrates `byGateway` from disk on construction,
    BEFORE serving any request: it reads `sumeru_session_index` (ordered by
    `created_at ASC`) and bulk-loads every session's ordered turn hashes in a
    single query. A closed session restores as `closed`; an idle/active session
    restores as `idle` (a restart can never leave a send mid-flight, so the
    transient `active` state normalizes to `idle`). When a session's `meta_hash`
    is `null` or its meta node is unreadable, `config` falls back to `{}` with a
    structured `[sumeru]` warning — turn history is the priority. Boot emits one
    `[sumeru] rehydrated <S> sessions, <T> turns` line.
  - New `SearchIndex` methods (closure over the single existing `DatabaseSync`
    handle): `appendSessionTurn`, `listSessionTurns`, `loadSessionTurnsBulk`,
    `loadSessionRows`. `PersistedSessionRow` type exported.
  - Documented non-goal: the adapter-side `NativeSessionRef` is live runtime
    state and is NOT persisted. A rehydrated session is read-complete (history
    works fully) but not resumable for new sends — `POST .../messages` hits the
    existing `nativeRef === null` branch and returns `503 adapter_unavailable`.
    The message endpoint surfaces any turn-list persistence failure as
    `turn_persist_failed` (clean 500 before the stream for the user turn; an
    in-stream `event: error` for assistant turns) rather than silently diverging
    memory from disk.
  
  The HTTP wire shapes are byte-identical; the only observable change is that
  turn history now survives a server restart.
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
- Phase 5: session search + export.
  
  - New SQLite FTS5 search index (`packages/server/src/search/`) backed by a
    second `node:sqlite` handle on `<ocasDir>/_store.db` — the same file
    `@ocas/fs` uses for vars/tags. Schema is bootstrapped on first open via
    `createSearchIndex(dbPath)`. Tables: `sumeru_turn_index` (one row per
    turn), contentless `sumeru_turn_fts` (FTS5 with `unicode61` tokenizer
    for CJK), and `sumeru_session_index` (per-session denormalized state).
    AFTER INSERT/DELETE triggers keep the FTS5 mirror in lockstep with the
    index table. All indexing paths are idempotent on the turn hash /
    session id, so re-indexing is a no-op.
  - `openSumeruOcas(dir)` now also opens the search index; `SumeruOcas`
    exposes `searchIndex: SearchIndex` alongside the store. Session
    create/close and turn write paths transparently feed the index — no
    caller changes required for Phase 1-4 code.
  - New endpoint `GET /sessions?q=<query>` performs cross-gateway search;
    `GET /gateways/:name/sessions?q=<query>` extends the Phase 2 list
    endpoint with per-gateway search. Both return a
    `@sumeru/search-result` envelope `{ query, gateway, total, offset,
    limit, results: SearchResultHit[] }` ordered by BM25 (best first).
    Supports `?gateway=<name>`, `?limit` (default 50, cap 100), `?offset`
    (default 0). Empty/whitespace `q` on top-level → `400 invalid_request`;
    on per-gateway → falls through to the existing Phase 2 session list.
    Each hit carries `relevance` normalized to `(0, 1]` via
    `1 / (1 + |bm25|)` and a `matchContext` snippet with `<<...>>` markers.
  - New endpoint `POST /gateways/:name/sessions/:id/export` returns the
    session's full recording (session-meta + every turn + their schema
    chain) as a self-contained `tar.gz`, built via
    `@ocas/core.exportBundle`. Headers: `Content-Type: application/gzip`,
    `Content-Disposition: attachment; filename="<sessionId>.tar.gz"`,
    `Cache-Control: no-store`, `X-Sumeru-Export-Nodes`,
    `X-Sumeru-Export-Session`, `Content-Length`. NO `Content-Encoding`
    (gzip is the payload format, not transport encoding). Closed and
    empty sessions are exportable. `HEAD` returns the same headers with
    an empty body. Temp-dir cleanup runs on response `finish` AND `close`,
    so client disconnects do not leak.
  - `quoteFtsPhrase(raw)`, `searchSessions(index, opts)`, and
    `rebuildSearchIndex(index, ocas, roots)` are exported from
    `@sumeru/server` for tooling and tests.
  - `README.md` HTTP table gains rows for the new search and export
    endpoints, and the Recording section gets a one-line note about
    `ocas import` round-tripping.
- CAS-backed SSE frame persistence + withResumable middleware (Phase A3, RFC #107)
- Make `rebuildSearchIndex` walk the ocas store via `listByType` instead of requiring callers to supply roots. The function now takes two arguments `(index, ocas)` — the third `roots` parameter is removed. Internally, the rebuild closure enumerates all `@sumeru/session-meta` and `@sumeru/turn` nodes by schema hash, uses `sumeru_session_turns` for turn→session association, and runs a corrective UPDATE to fix `turn_count`/`last_active_at`. Orphaned turns are skipped with a warn-level log.
  
  Fixes #59
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
- Phase 2: session lifecycle endpoints.
  
  - New `POST /gateways/:name/sessions` creates an in-memory session and returns
    a `@sumeru/session` envelope with HTTP 201. Session IDs are `ses_` + a
    26-character Crockford Base32 ULID, generated server-side. Client-supplied
    `id` fields in the request body are ignored.
  - The `config` field of the request body is treated as **opaque**: Sumeru
    passes it through verbatim (preserves unknown keys, never validates,
    normalizes, or renames). Empty/missing bodies are equivalent to `{}`.
    Malformed JSON returns `400 invalid_json`; a non-object `config` returns
    `400 invalid_request`.
  - New `GET /gateways/:name/sessions` returns a `@sumeru/session-list` envelope.
    Listings are scoped per gateway, ordered by creation, omit `config`, and
    **include closed sessions**.
  - New `GET /gateways/:name/sessions/:id` returns a full `@sumeru/session`
    envelope (including `config`). Lookups are scoped to the gateway: requesting
    a session under a different gateway returns `404 session_not_found`.
  - New `DELETE /gateways/:name/sessions/:id` flips the session's status to
    `closed` and returns `204 No Content`. Deletes are **idempotent** —
    re-closing a closed session is a 204 no-op. Closed sessions remain
    queryable (status `closed`) for inspection.
  - Status state machine: `idle → active → idle | closed`, with a typed
    `SessionStatus = "idle" | "active" | "closed"`. Helpers `tryActivate` and
    `markIdle` on the session store define the 409 `session_busy` contract for
    the future message endpoint (currently unit-tested via the helper).
  - `GET /gateways` and `GET /gateways/:name` now report `activeSessions` as the
    count of non-closed sessions on the gateway, replacing the Phase-1
    hard-coded `0`.
  - All Phase-2 success bodies are `{ type, value }` envelopes; all failures use
    `@sumeru/error` with stable codes (`gateway_not_found`, `session_not_found`,
    `invalid_json`, `invalid_request`, `method_not_allowed`, `session_busy`).
    Method mismatches return 405 with a populated `Allow` header.
- Refactor to streaming-first adapter contract. `Adapter.send` now returns `AsyncIterable<SendEvent>` instead of `Promise<AgentResponse>`. Introduce `SessionConfig` and `SendEvent` types. Remove `AgentResponse` and `AdapterCapabilities`. Rewrite all adapters and server message handler to consume the stream incrementally.

