---
id: cli
title: "CLI Adapter Wiring"
sources:
  - packages/cli/src/build-adapters.ts
  - packages/cli/package.json
  - packages/cli/tests/build-adapters.test.ts
  - packages/cli/tests/start-with-gateway-config.test.ts
tags: [architecture, cli, adapters, config]
created: 2026-06-15
updated: 2026-06-23
---

# CLI Adapter Wiring

The CLI builds the runtime adapter registry from gateway config using `buildAdapters()`.

## Factory Registry

`DEFAULT_ADAPTER_FACTORIES` now includes four built-in adapter keys:

- `hermes`
- `claude-code`
- `codex`
- `cursor-agent`

Each key maps to the corresponding package factory:

- `createHermesAdapter`
- `createClaudeCodeAdapter`
- `createCodexAdapter`
- `createCursorAgentAdapter`

The CLI package also depends on all four adapter packages in `packages/cli/package.json`.

## Config Propagation Semantics

`buildAdapters(gateways, factories?)` behavior:

1. Iterate every configured gateway.
2. Resolve `factory = factories[gw.adapter]`.
3. If no factory exists, skip gateway silently.
4. Pass `gw.config ?? {}` verbatim to the factory.
5. Store adapter instance under the gateway name.

This means:

- The CLI does not validate adapter-specific config keys.
- Multiple gateways sharing one adapter type still receive independent option blobs and independent adapter instances.
- Unknown adapters do not crash startup; they remain unavailable at server surface.

## Test Coverage Highlights

`packages/cli/tests/build-adapters.test.ts` verifies:

- no-config gateways call factories with `{}`
- populated config blobs are forwarded unchanged
- duplicate adapter types produce separate instances
- unknown adapters are skipped without throw
- arbitrary/unknown config keys are still forwarded
- cursor-agent config forwarding works
- default registry includes cursor-agent wiring

`packages/cli/tests/start-with-gateway-config.test.ts` verifies end-to-end that parsed YAML gateway config reaches adapter factories through `loadConfig(...) -> buildAdapters(...)`, preserving configured timeout values and per-gateway differences.
