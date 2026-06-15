---
scenario: "sumeru.yaml gateway entries accept an optional opaque `config:` blob; loadConfig parses it onto GatewayConfig and tolerates absence"
feature: server-config
tags: [config, yaml, gateway, adapter-options, phase-6, issue-32]
---

## Given
- The repo is checked out at branch `fix/32-adapter-timeout-config` from `origin/main`.
- `@sumeru/server` already exposes `loadConfig`, `InstanceConfig`, `GatewayConfig`, `GatewayCapabilities` per `specs/config-load-yaml.md`. This spec **extends** the parser, it does not replace it.
- The current `GatewayConfig` shape is exactly:
  ```typescript
  type GatewayConfig = {
    adapter: string;
    capabilities: GatewayCapabilities;
  };
  ```
- The rationale for this change is issue #32: the `claude-code` adapter's `sendTimeoutMs` (10 min default) is too short for long-running tasks (15-25 min CC runs). Operators need to override per-gateway adapter options without editing source. The mechanism must be **adapter-agnostic** — the server does NOT validate or normalize the blob; it forwards it verbatim to the adapter factory at boot.

## When
- A contributor adds an optional `config:` field to `GatewayConfig`:
  ```typescript
  type GatewayConfig = {
    adapter: string;
    capabilities: GatewayCapabilities;
    /**
     * Adapter-specific options blob. Forwarded verbatim to the adapter
     * factory at boot via the CLI (see `cli-pass-gateway-config.md`).
     * `null` when absent in YAML — never `undefined`.
     */
    config: Record<string, unknown> | null;
  };
  ```
- New fixtures are added under `packages/server/tests/fixtures/`:
  1. `sumeru.gateway-with-config.yaml`:
     ```yaml
     name: sumeru@neko
     gateways:
       claude-code:
         adapter: claude-code
         config:
           sendTimeoutMs: 1800000
           createSessionTimeoutMs: 300000
           maxTurns: 120
         capabilities:
           resume: true
           streaming: true
     ```
  2. `sumeru.gateway-config-empty.yaml` — gateway entry with `config: {}`.
  3. `sumeru.gateway-config-null.yaml` — gateway entry with `config: null`.
  4. `sumeru.gateway-config-not-object.yaml` — gateway entry with `config: 42` (invalid).
  5. `sumeru.gateway-config-array.yaml` — gateway entry with `config: [1,2,3]` (invalid).
- Existing fixtures (e.g. `sumeru.valid.yaml`, `sumeru.two-gateways.yaml`) are NOT changed.

## Then
- `loadConfig("sumeru.gateway-with-config.yaml")` resolves to:
  ```typescript
  {
    name: "sumeru@neko",
    workspaceRoot: null,
    gateways: {
      "claude-code": {
        adapter: "claude-code",
        capabilities: { resume: true, streaming: true },
        config: {
          sendTimeoutMs: 1800000,
          createSessionTimeoutMs: 300000,
          maxTurns: 120,
        },
      },
    },
  }
  ```
- `loadConfig("sumeru.gateway-config-empty.yaml")` resolves with `gateways[k].config === {}` (an empty object, NOT `null`).
- `loadConfig("sumeru.gateway-config-null.yaml")` resolves with `gateways[k].config === null`.
- For fixtures **without** a `config:` field (every existing fixture), `gateways[k].config === null`. The shape of all previously-passing test cases is unchanged except for the new explicit `config: null` field.
- `loadConfig("sumeru.gateway-config-not-object.yaml")` throws an `Error` whose `.message`:
  - Includes the source file path,
  - Includes the gateway key (e.g. `"claude-code"`),
  - Includes the field name `"config"`,
  - Mentions the actual shape received (e.g. `must be a mapping (got number)`).
- `loadConfig("sumeru.gateway-config-array.yaml")` throws with a similar message (`must be a mapping (got array)`).
- The parser does **not** validate the contents of `config` — unknown / arbitrary keys inside it are passed through unchanged. This is intentional: each adapter validates its own option keys.
- Insertion order of keys inside `config` is preserved (YAML mapping order).
- Top-level `name` and `gateways` validation is unchanged.
- `workspaceRoot` validation is unchanged.
- Capability flag validation is unchanged.
- Unknown keys at the top level and inside individual gateway entries (other than `adapter`, `capabilities`, `config`) continue to be tolerated for forward-compatibility.
- `@sumeru/server` continues to export `GatewayConfig` from its public `index.ts`. Downstream code that imports `GatewayConfig` continues to compile because `config` is a non-optional field on the type but every parsed gateway always has the field set (to `null` when absent).
- A new test file `packages/server/tests/config-gateway-blob.test.ts` covers all five new fixtures plus a regression test that pre-existing fixtures still parse.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0.
- A `.changeset/<slug>.md` is added declaring `@sumeru/server` as a `minor` bump with a one-line description: `Allow per-gateway adapter config blob in sumeru.yaml (#32)`.
