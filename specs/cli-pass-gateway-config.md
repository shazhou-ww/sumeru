---
scenario: "CLI applies per-gateway `config` blob from sumeru.yaml when constructing each adapter, so timeouts and other adapter options are operator-tunable without rebuilding"
feature: server-adapter-integration
tags: [cli, adapter, gateway, adapter-options, claude-code, hermes, phase-6, issue-32]
---

## Given
- `specs/config-load-gateway-config-blob.md` has landed: `GatewayConfig` now carries a `config: Record<string, unknown> | null` field, parsed verbatim from `sumeru.yaml`.
- The current CLI (`packages/cli/src/cli.ts`) constructs adapters with empty options:
  ```typescript
  adapters: {
    hermes: createHermesAdapter({}),
    "claude-code": createClaudeCodeAdapter({}),
  }
  ```
- The two adapter factories already accept partial options:
  - `createClaudeCodeAdapter(opts?: Partial<ClaudeCodeAdapterOptions>): Adapter`
  - `createHermesAdapter(opts?: Partial<HermesAdapterOptions>): Adapter`
- `ClaudeCodeAdapterOptions` (existing, unchanged by this spec) includes:
  - `claudeBin: string | null`
  - `model: string | null`
  - `maxTurns: number | null`
  - `cwd: string | null`
  - `createSessionTimeoutMs: number | null`
  - `sendTimeoutMs: number | null`
  - `spawnFn: SpawnFn | null` (test seam — never accepted from YAML)
- The factory's existing `??` fallback chain is preserved: any field set to `null` (or absent) falls through to the hard-coded default.

## When
- The contributor changes `packages/cli/src/cli.ts` so that, after `loadConfig` returns, the CLI walks the `gateways` map and constructs each adapter with the gateway's parsed `config` blob:
  ```typescript
  function buildAdapters(
    gateways: Record<string, GatewayConfig>,
  ): Record<string, Adapter> {
    const adapters: Record<string, Adapter> = {};
    for (const [name, gw] of Object.entries(gateways)) {
      const opts = gw.config ?? {};
      switch (gw.adapter) {
        case "hermes":
          adapters[name] = createHermesAdapter(opts);
          break;
        case "claude-code":
          adapters[name] = createClaudeCodeAdapter(opts);
          break;
        default:
          // Adapter package not bundled by this CLI build — leave the
          // gateway's adapter slot empty so the registry reports
          // `status: "unavailable"`.
          break;
      }
    }
    return adapters;
  }
  ```
- The contributor runs `sumeru start --config <path>` against each of these scenarios:
  1. `sumeru.yaml` has no `config:` block on any gateway → adapter factories are called with `{}`.
  2. `sumeru.yaml` declares `gateways.claude-code.config.sendTimeoutMs: 1800000` (30 min) → factory is called with that exact options object.
  3. `sumeru.yaml` declares an unknown adapter (e.g. `adapter: bogus`) → no entry is added to the adapters map; the gateway is reported `status: "unavailable"`.
  4. `sumeru.yaml` declares the same adapter twice under different gateway names → each gateway gets its own adapter instance built from its own `config:` blob.
  5. `sumeru.yaml` declares `gateways.claude-code.config.spawnFn: "haha"` (an invalid value forwarded from YAML) → see "Adapter validates its own options" below.

## Then
- **No-config path is unchanged** — When every gateway in `sumeru.yaml` omits `config:`, the CLI's behavior is byte-identical to before this spec: factories are called with `{}` and run with their hard-coded defaults.
- **Per-gateway config forwarding** — When `gateways.claude-code.config = { sendTimeoutMs: 1800000, createSessionTimeoutMs: 300000, maxTurns: 120 }`, `createClaudeCodeAdapter` is called with that exact object. The returned adapter, when `send` is invoked, uses `1800000` ms as its timeout (verifiable via the existing `sendTimeoutMs` test seam in `adapter-claude-code-send.md`).
- **Independent adapter instances** — Two gateways using the same adapter type get two distinct adapter instances. Each instance reads ONLY its own `config` blob; they do not share options. (Tested by declaring two `adapter: claude-code` gateways with different `sendTimeoutMs` values and verifying via the spawn fake that each gateway's invocations use its own timeout.)
- **Unknown adapter type → unavailable** — A gateway whose `adapter:` is not one of the known names (`hermes`, `claude-code`) does NOT cause the CLI to throw. It is silently omitted from the adapters map, and `GET /gateways` reports it as `status: "unavailable"` (per the existing registry contract in `specs/adapter-claude-code-server-integration.md`).
- **Adapter validates its own options** — The CLI does NOT validate the shape of `config`. If a YAML value is wrong for the adapter (e.g. `sendTimeoutMs: "30 minutes"` as a string, or a `spawnFn` value), it is the **adapter factory's** responsibility to reject. Existing factories tolerate `null` per their defaults; bad values cause runtime errors when the adapter is exercised, NOT at boot. The CLI must never crash on a YAML-supplied option blob.
- **`adapter` field still required** — A gateway entry without `adapter` continues to throw at `loadConfig` time (per the existing `config-load-yaml.md` contract). This spec does not change that.
- **Default `sumeru.yaml` (no --config)** — `sumeru start` (no `--config`) continues to call both factories with `{}`. Behavior is unchanged.
- **Project default `sumeru.yaml`** — The project's own `sumeru.yaml` may optionally add `config:` blocks (e.g. raise the CC `sendTimeoutMs` to 30 min). When this spec lands, the file SHOULD be updated to include:
  ```yaml
  gateways:
    claude-code:
      adapter: claude-code
      config:
        sendTimeoutMs: 1800000
      capabilities:
        resume: true
        streaming: true
  ```
  This documents the recommended override for long-running solve-issue tasks. The exact value is operator-tunable.
- **Tests** —
  - `packages/cli/tests/start-with-gateway-config.test.ts` boots the CLI with a config containing `sendTimeoutMs: 1800000`, intercepts the adapter factory (via dependency injection of an adapter-builder seam OR via a captured spawn fn), and asserts:
    - The adapter factory was called with the parsed options object,
    - A subsequent `send` call uses the configured timeout (verifiable through the spawn fake),
    - `GET /gateways` reports both gateways `ready`.
  - `packages/cli/tests/start-unknown-adapter.test.ts` boots with `adapter: bogus` and asserts the CLI does not crash; `GET /gateways` reports the bogus gateway `unavailable`.
  - All existing `packages/cli/` and `packages/server/` tests continue to pass unchanged.
- **Documentation in CLAUDE.md / README** — A short section is added under "Configuration" (or similar) describing the new optional `config:` block per gateway, with the `claude-code` `sendTimeoutMs` override as the motivating example. Format: 2-5 lines, links back to the adapter's options reference.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
- The change is captured in a `.changeset/<slug>.md` declaring:
  - `@sumeru/cli` — `minor` (new behavior: forwards gateway config blobs to adapter factories).
  - `@sumeru/server` — already covered by `specs/config-load-gateway-config-blob.md`.
