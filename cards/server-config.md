---
id: server-config
title: "Server Startup and Gateway Wiring"
sources:
  - packages/server/src/start.ts
  - packages/server/src/handler.ts
  - packages/server/src/types.ts
  - packages/server/tests/start-gateway-log.test.ts
  - packages/cli/src/build-adapters.ts
  - README.md
tags: [architecture, server, startup, configuration]
created: 2026-06-15
updated: 2026-06-23
---

# Server Startup and Gateway Wiring

This card covers the current startup-time config behavior in `@sumeru/server`, with emphasis on gateway adapter wiring and startup logging.

## StartConfig and Defaults

`startServer(config: StartConfig)` consumes:

- instance identity: `name`, `version`
- bind settings: `host`, `port`
- gateway config map: `gateways`
- runtime wiring: `adapters` (nullable), `workspaceRoot`
- SSE knobs: `sseHeartbeatMs`, `sseBufferSize`, `sseRetentionMs` (nullable)
- storage location override: `ocasDir` (nullable)

Applied defaults in startup path:

- `adapters`: `config.adapters ?? {}`
- `sseHeartbeatMs`: `15_000`
- `sseBufferSize`: `1024`
- `sseRetentionMs`: `30_000`

## OCAS Directory Resolution

`resolveOcasDir(explicit)` precedence:

1. explicit `StartConfig.ocasDir` (non-empty)
2. `SUMERU_OCAS_DIR` env var (non-empty)
3. `~/.sumeru/ocas`

Behavior details:

- `~/...` is expanded against `os.homedir()`
- returned path is absolute (`path.resolve`)
- OCAS store is opened before listener bind; filesystem failures prevent server start

## Gateway Startup Logging (New Behavior)

During startup, server logs:

1. one OCAS line:
   - `[sumeru] ocas store: <resolvedPath>`
2. one line per configured gateway, in config declaration order:
   - `[sumeru] gateway <gatewayName> -> adapter @sumeru/adapter-<adapterName> (ready)`
   - or `(unavailable: not registered)`

Readiness is determined by whether the gateway name has an adapter instance in the `adapters` registry passed to `startServer`.

`packages/server/tests/start-gateway-log.test.ts` locks this behavior, including ordering and exact log format constraints.

## CLI-to-Server Adapter Wiring

The CLI constructs the server `adapters` map via `buildAdapters(gateways)`.

`buildAdapters` semantics:

- adapter factories include: `hermes`, `claude-code`, `codex`, `cursor-agent`
- each gateway uses `factory = factories[gw.adapter]`
- unknown adapters are skipped (no throw)
- per-gateway `gw.config` is forwarded verbatim (`null` -> `{}`)
- resulting map is keyed by gateway name

Important nuance: startup logging and `GET /gateways` do not currently use the same lookup key.

- Startup log readiness in `startServer` checks by gateway name (`gatewayName in adapters`).
- Gateway readiness in handler list/detail checks by adapter name (`adapters[cfg.adapter] !== undefined`).

With `buildAdapters()` producing a gateway-keyed map, these two surfaces can diverge.

## Relevant Types

From `packages/server/src/types.ts`:

- `GatewayConfig` keeps adapter name, capabilities, and opaque `config` blob
- `StartConfig` uses nullable runtime fields for defaults
- `ServerConfig` carries normalized runtime values into `createHandler`

This keeps adapter-specific option validation in adapter packages, not in server startup code.
