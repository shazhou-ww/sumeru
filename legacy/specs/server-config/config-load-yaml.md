---
scenario: "sumeru.yaml is parsed into a typed config (name + gateways) and rejects malformed input"
feature: server-config
tags: [config, yaml, parsing, validation, phase-1]
---

## Given
- The repo is checked out at branch `fix/11-config-readonly-endpoints` with Phase 0 already merged.
- `@sumeru/server` exposes a named export `loadConfig(path: string): Promise<InstanceConfig>` (or a sync `loadConfigSync`) that reads a YAML file and returns a parsed `InstanceConfig`.
- `InstanceConfig` is exported from `@sumeru/server` and is shaped exactly:
  ```typescript
  type InstanceConfig = {
    name: string;
    gateways: Record<string, GatewayConfig>;
  };
  type GatewayConfig = {
    adapter: string;
    capabilities: GatewayCapabilities;
  };
  type GatewayCapabilities = {
    resume: boolean;
    streaming: boolean;
  };
  ```
  No optional `?:` properties — capabilities flags are required booleans.
- A YAML parser is available as a runtime dependency (e.g. `yaml` from npm). It is declared in `packages/server/package.json` `dependencies`, not `devDependencies`.
- A sample fixture file `packages/server/tests/fixtures/sumeru.valid.yaml` contains:
  ```yaml
  name: sumeru@neko

  gateways:
    hermes:
      adapter: hermes
      capabilities:
        resume: true
        streaming: true

    claude-code:
      adapter: claude-code
      capabilities:
        resume: true
        streaming: false
  ```

## When
- A test calls `await loadConfig("packages/server/tests/fixtures/sumeru.valid.yaml")`.
- A test calls `loadConfig` against each malformed fixture below:
  1. `sumeru.missing-name.yaml` — top-level `name` field is absent.
  2. `sumeru.gateways-not-object.yaml` — `gateways: []` (array instead of map).
  3. `sumeru.gateway-missing-adapter.yaml` — a gateway entry has no `adapter` key.
  4. `sumeru.gateway-missing-capabilities.yaml` — a gateway entry has no `capabilities` key.
  5. `sumeru.bad-yaml.yaml` — file contents are not valid YAML (e.g. `:::`).
  6. `sumeru.does-not-exist.yaml` — file path does not exist on disk.

## Then
- The valid fixture resolves to:
  ```typescript
  {
    name: "sumeru@neko",
    gateways: {
      hermes: {
        adapter: "hermes",
        capabilities: { resume: true, streaming: true },
      },
      "claude-code": {
        adapter: "claude-code",
        capabilities: { resume: true, streaming: false },
      },
    },
  }
  ```
- The order of keys in `gateways` is preserved as defined in the YAML file (insertion order).
- Each malformed fixture causes `loadConfig` to throw an `Error` whose `.message` includes:
  - the offending field name (e.g. `name`, `gateways`, `adapter`, `capabilities`) where applicable, AND
  - the source file path (so the operator can locate the broken config).
- For the missing-file case, the thrown error is an instance of `Error` (not raw `ENOENT` from `node:fs`); its `.message` mentions the path and a human-readable hint such as `not found` or `cannot be read`.
- Unknown top-level keys (e.g. `gateways` plus an extra `unknown_field: 1`) are tolerated for forward-compatibility — they do NOT cause `loadConfig` to throw.
- Unknown keys inside a gateway entry (e.g. `gateways.hermes.foo: bar`) are ignored, NOT thrown — only the three known fields (`adapter`, `capabilities.resume`, `capabilities.streaming`) are validated.
- The function never returns `null` or `undefined` — on error it throws; on success it returns a fully-populated `InstanceConfig`.
- The `@sumeru/server` package exports `loadConfig`, `InstanceConfig`, `GatewayConfig`, and `GatewayCapabilities` from its public `index.ts`.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0 after the change. The new code uses no `class`, no `interface`, no default exports, and no optional `?:` properties.
