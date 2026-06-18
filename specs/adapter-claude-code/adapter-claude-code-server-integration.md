---
scenario: "@sumeru/cli wires `createClaudeCodeAdapter` into `startServer`'s adapter registry alongside `hermes`, so a `sumeru.yaml` declaring `adapter: claude-code` resolves to a `ready` gateway and `POST /gateways/claude-code/sessions` reaches the adapter; absence of either adapter package gracefully degrades the matching gateway to `unavailable`"
feature: server-adapter-integration
tags: [server, cli, adapter, claude-code, gateway, registry, phase-3]
---

## Given
- `@sumeru/adapter-hermes` and `@sumeru/adapter-claude-code` are both built workspace packages.
- The server's `startServer` already accepts `adapters?: Record<string, Adapter>` (see `specs/server-adapter-integration.md`); Phase 3's hermes-only spec is unchanged — this spec extends the wiring to a multi-adapter map.
- `packages/cli/src/cli.ts` currently passes `adapters: { hermes: createHermesAdapter({}) }`. This spec changes it to import and pass both adapters: `adapters: { hermes: createHermesAdapter({}), "claude-code": createClaudeCodeAdapter({}) }`.
- A new fixture `packages/server/tests/fixtures/sumeru.claude-code.yaml` declares:
  ```yaml
  name: sumeru@test
  gateways:
    claude-code:
      adapter: claude-code
      capabilities:
        resume: true
        streaming: false
  ```
- The existing fixture `packages/server/tests/fixtures/sumeru.two-gateways.yaml` declares both `hermes` and `claude-code` gateways.
- The default project config `sumeru.yaml` is updated to add a `claude-code` gateway entry (with `streaming: false` per the issue's "MVP 不需要 streaming adapter").

## When
- A test boots the server with the fixture and a synthetic adapter map:
  ```typescript
  const server = await startServer({
    port: 0, host: "127.0.0.1",
    name: "sumeru@test",
    version: "0.0.0",
    gateways: parsed.gateways,
    adapters: { "claude-code": fakeClaudeAdapter },
    sseHeartbeatMs: null, sseBufferSize: null, sseRetentionMs: null,
    ocasDir: null,
  });
  ```
- The client issues:
  ```
  curl -fsS -i -X POST -H 'Content-Type: application/json' \
    -d '{"config":{"model":"claude-sonnet-4-5","initialQuery":"hi"}}' \
    http://127.0.0.1:<port>/gateways/claude-code/sessions
  ```

## Then
- **Adapter resolution at boot** —
  - `GET /gateways` reports `status: "ready"` for `claude-code` when `adapters["claude-code"]` is registered. Reports `status: "unavailable"` when it is missing from the registry. The hermes gateway's status is unaffected.
  - The startup log line follows the same shape as the existing one: `gateway claude-code -> adapter @sumeru/adapter-claude-code (ready)` (or `(unavailable: not registered)`).
  - The startup behavior is testable in unit tests by passing `adapters: {}` (empty map) — both `hermes` and `claude-code` gateways report `unavailable`.
- **POST creates a session via the CC adapter** — After the POST returns 201, the server's session store has a record with:
  - `gateway: "claude-code"`,
  - `nativeRef.nativeId === <whatever the fake adapter returned>`,
  - `config` byte-identical to the request body's `config` (per Phase-2 contract).
  - The fake adapter's `createSession` was called exactly once, with the request's `config` blob unchanged.
- **No `nativeId` leakage** — The 201 response body matches the existing `@sumeru/session` envelope (5-key shape: `id`, `gateway`, `status`, `createdAt`, `config`). No `nativeId` field. The Phase-2 regex test (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` for CC UUIDs, `/^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/` for hermes ids) MUST match zero times across all Phase-3 multi-adapter response bodies in the test suite.
- **Adapter failure → 502** — A test that injects a CC adapter whose `createSession` rejects with `"simulated boom"` produces:
  - HTTP `502 Bad Gateway`.
  - Body envelope: `value.error: "adapter_error"`, `value.message: "claude-code adapter failed: simulated boom"` (or similar — must include both gateway name AND underlying message).
  - No session is created.
- **Adapter timeout** — If `createSession` exceeds `createSessionTimeoutMs`, the adapter rejects (per its own spec) and the server returns `504 Gateway Timeout` with `error: "adapter_timeout"`.
- **POST /messages → adapter.send** — `POST /gateways/claude-code/sessions/<ses_id>/messages` (the SSE endpoint, specced in Phase 4) calls the CC adapter's `send` exactly once with the request's `content`. The adapter's returned turns are streamed as `event: turn` SSE events (Phase-4 endpoint).
- **DELETE → adapter.close** — `DELETE /gateways/claude-code/sessions/<ses_id>` calls the CC adapter's `close` exactly once with the session's `nativeRef` BEFORE flipping the session status to `"closed"`. If `close` rejects, the session is still flipped to `closed` and the adapter error is logged at WARN level (idempotent close — same contract as `server-adapter-integration.md`).
- **Mixed gateway concurrency** — Two parallel POSTs, one to `/gateways/hermes/sessions` and one to `/gateways/claude-code/sessions`, each succeed independently. The two adapters are NOT serialized against each other.
- **CLI default boot** — `sumeru start` (no `--config`) starts the server with both adapters in the registry. `GET /gateways` returns an empty list (no gateways are configured without a yaml), but the registry is ready to accept a config that adds them. (Behavior matches Phase-1 — config drives the gateway list, adapters drive the registry; the two are joined at lookup time.)
- **CLI with --config** — `sumeru start --config sumeru.yaml` (using the project's updated `sumeru.yaml` with both gateways) reports both `hermes` and `claude-code` as `ready` at `GET /gateways` when both adapter packages resolve correctly.
- **Adapter package missing at runtime** — If the CC adapter package is uninstalled from the workspace, the CLI's import statement fails at boot with a clear error (`"Cannot find module '@sumeru/adapter-claude-code'"`). Treat this as a build/install issue, not a runtime degradation. The adapter registry-based degradation only applies when the gateway is configured but no adapter is registered (e.g. tests deliberately omit it).
- **No new HTTP shapes** — This spec adds NO new endpoints. Existing endpoints simply route to the new adapter when `gateway === "claude-code"`.
- **Tests** under:
  - `packages/server/tests/adapter-integration-claude-code.test.ts` — mirrors the existing `adapter-integration.test.ts` but for the CC gateway. Uses a fake adapter to assert wiring without spawning real `claude`.
  - `packages/cli/tests/start-with-claude-code.test.ts` — boots the CLI with an injected adapter map; asserts `GET /gateways` reports both adapters as `ready`.
- All Phase-1, Phase-2, and existing Phase-3 (hermes) tests continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
