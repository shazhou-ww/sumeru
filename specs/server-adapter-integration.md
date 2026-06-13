---
scenario: "@sumeru/server resolves an Adapter for each gateway at startup using sumeru.yaml's `adapter` field, calls adapter.createSession() during POST /gateways/:name/sessions, and stores the NativeSessionRef alongside the session record"
feature: server-adapter-integration
tags: [server, adapter, gateway, registry, session, ses-id-mapping, phase-3]
---

## Given
- A `sumeru start --port 0 --config tests/fixtures/sumeru.two-gateways.yaml` process is running.
- The fixture declares a `hermes` gateway with `adapter: hermes`.
- Phase 3 introduces a server-side **adapter registry**: a `Record<string, Adapter>` keyed by adapter name (e.g. `"hermes"` → instance from `createHermesAdapter()`).
- The server's `startServer({ adapters?: Record<string, Adapter>, ... })` accepts an optional `adapters` map; when not supplied, the CLI builds the default map by importing each `@sumeru/adapter-*` package and calling its factory.
- The session store gains a new internal field `nativeRef: NativeSessionRef | null` per session (NOT exposed in HTTP envelopes — purely internal). The wire shape `@sumeru/session` is unchanged from Phase 2.

## When
- The CLI starts the server with `--config tests/fixtures/sumeru.two-gateways.yaml`. The server boots, looks up `adapters["hermes"]` (the `@sumeru/adapter-hermes` factory result), and registers it under gateway `hermes`. It does the same for `claude-code`, but if the `claude-code` adapter package is absent from the registry, the server logs a warning and marks that gateway's status as `"unavailable"` (rather than failing to start — graceful degradation).
- The client issues `curl -fsS -i -X POST -H 'Content-Type: application/json' -d '{"config":{"model":"anthropic/claude-haiku-4"}}' http://127.0.0.1:<port>/gateways/hermes/sessions`.
- The server:
  1. Resolves the adapter for `hermes` (must be present, status `ready`).
  2. Calls `adapter.createSession({ model: "anthropic/claude-haiku-4" })`.
  3. On success: generates a `ses_<ULID>`, stores `{ id, gateway: "hermes", status: "idle", createdAt, config, nativeRef }` in the session store, and returns the `@sumeru/session` envelope.
  4. On adapter failure: returns `502 Bad Gateway` with a `@sumeru/error` envelope (`error: "adapter_error"`, `message` containing the adapter's error message, truncated to 500 chars).

## Then
- **Adapter resolution at boot** —
  - `GET /gateways` reports `status: "ready"` for gateways whose adapter is loaded; `"unavailable"` for those whose adapter is missing from the registry. The `unavailable` gateway accepts NO write operations: `POST .../sessions` returns `503 Service Unavailable` with `error: "adapter_unavailable"`.
  - The server logs a single line per gateway at startup: `gateway hermes -> adapter @sumeru/adapter-hermes (ready)` or `gateway claude-code -> adapter @sumeru/adapter-claude-code (unavailable: not registered)`.
  - The startup behavior is testable in unit tests by passing a synthetic `adapters` map to `startServer` and asserting `GET /gateways` JSON.
- **POST creates a real native session** — After the `POST` returns 201, calling `hermes sessions list --source sumeru` shows a session whose ID maps 1:1 to the returned `ses_…` ID via the server's internal store. The mapping is **never exposed** over HTTP: the `@sumeru/session` envelope keeps its Phase-2 five-key shape (`id`, `gateway`, `status`, `createdAt`, `config`), with no `nativeId` field.
- **`config` round-trips unchanged** — Phase-2 spec (`server-session-create-endpoint.md`) is unchanged: the response body's `value.config` is byte-identical to the request body's `config`. The fact that adapter received the same blob is an internal implementation detail.
- **Adapter failure → 502** — A unit test injects an `Adapter` whose `createSession` rejects with `Error("simulated boom")`. POST returns:
  - HTTP `502 Bad Gateway`.
  - Body `@sumeru/error` envelope, `value.error: "adapter_error"`, `value.message: "hermes adapter failed: simulated boom"` (or similar — must include both the gateway name and the underlying message).
  - No session is created (a subsequent `GET /gateways/hermes/sessions` does not list it).
  - The session store's `activeCount` for `hermes` is unchanged.
- **Adapter timeout** — If `createSession` takes longer than `HermesAdapterOptions.createSessionTimeoutMs` (60 s default), the adapter rejects (per its own spec) and the server returns `504 Gateway Timeout` with `error: "adapter_timeout"`.
- **Concurrency** — Two parallel POST requests to the same gateway each receive a unique `ses_…` and a unique `nativeRef.nativeId`. The session store does NOT serialize creates.
- **DELETE → adapter.close** — When the client issues `DELETE /gateways/hermes/sessions/<ses_id>`:
  - The server retrieves the session, looks up its `nativeRef`, and calls `adapter.close(nativeRef)` BEFORE flipping the session's status to `closed`.
  - If `adapter.close` rejects, the server still flips the status to `closed` (the session is "logically dead" in Sumeru regardless of adapter state) but logs the adapter error at WARN level. HTTP response remains `204` (idempotent close — adapter errors do NOT produce 502 here, since the user's intent is "stop using this session" and that is observable from Sumeru).
  - This behavior is documented in the existing `server-session-delete-endpoint.md` as a forward-compat note; Phase-3 implements the call-through.
- **Listing & detail unchanged** — `GET /gateways/:name/sessions` and `GET /gateways/:name/sessions/:id` return the same shapes as Phase 2; they do NOT call the adapter, since they read only the in-memory session store.
- **No `nativeId` leakage** — A regex test scans the JSON body of every Phase-3 response for any string matching `/^[0-9]{8}_[0-9]{6}_[0-9a-f]+$/` (Hermes ID shape). It must match zero times across the spec's test scenarios.
- **CLI wiring** — `@sumeru/cli`'s `start` command imports `createHermesAdapter` from `@sumeru/adapter-hermes` and passes `adapters: { hermes: createHermesAdapter() }` into `startServer`. A unit test mocks the adapter to verify the wiring without spawning real `hermes`.
- **Tests** under `packages/server/tests/adapter-integration.test.ts` and `packages/cli/tests/start-with-adapter.test.ts`. Coverage:
  - Boot with a registered adapter → `status: ready`.
  - Boot without a registered adapter → `status: unavailable`, `POST .../sessions` returns 503.
  - POST → adapter.createSession is called once with the request's `config`.
  - POST → the returned session record has `nativeRef` populated internally.
  - DELETE → adapter.close is called once.
  - Adapter rejection → 502 `adapter_error`.
  - Adapter timeout → 504 `adapter_timeout`.
  - Listing/detail responses contain no `nativeId`.
- All Phase-1 and Phase-2 tests continue to pass.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
