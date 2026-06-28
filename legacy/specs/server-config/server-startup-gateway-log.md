---
scenario: "startServer prints one log line per gateway showing adapter resolution status at boot"
feature: server-startup
tags: [server, gateway, adapter, startup, logging, phase-3]
---

## Given
- A `StartConfig` with two gateways declared in `config.gateways`:
  - `hermes` with `adapter: "hermes"`
  - `claude-code` with `adapter: "claude-code"`
- The `adapters` map passed to `startServer` contains only `{ hermes: <Adapter> }` (the `claude-code` key is absent).
- The server calls `startServer(config)` which internally calls `createHandler(serverConfig)`.

## When
- `startServer` boots and resolves each gateway's adapter from the `adapters` registry.

## Then
- **Per-gateway log lines** — After the existing `[sumeru] ocas store: <dir>` line and before the HTTP listener binds, `startServer` prints one line to stdout per gateway in config declaration order:
  - For a gateway with a registered adapter: `[sumeru] gateway hermes -> adapter @sumeru/adapter-hermes (ready)`
  - For a gateway without a registered adapter: `[sumeru] gateway claude-code -> adapter @sumeru/adapter-claude-code (unavailable: not registered)`
- **Format** — Each line matches the regex:
  ```
  ^\[sumeru\] gateway [\w-]+ -> adapter @sumeru/adapter-[\w-]+ \((ready|unavailable: not registered)\)$
  ```
- **Adapter package name derivation** — The logged package name is `@sumeru/adapter-<adapterField>` where `<adapterField>` is the gateway's `adapter` value from config (e.g. `adapter: "hermes"` logs `@sumeru/adapter-hermes`).
- **Order** — Lines are printed in the same order as `Object.keys(config.gateways)` (YAML key order preserved by the config loader).
- **No extra lines** — Exactly one line per gateway. No banner, no summary count.
- **Testability** — A unit test in `packages/server/tests/start-gateway-log.test.ts` intercepts `console.log` (or uses a log spy), boots `startServer` with `port: 0` and a synthetic `adapters` map, asserts the expected lines appear, then calls `stop()`.
- **Existing behavior unchanged** — The `[sumeru] ocas store: <dir>` line continues to print before the gateway lines.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
