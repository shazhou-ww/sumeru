---
scenario: "loadConfig parses an optional top-level workspaceRoot string and surfaces it on InstanceConfig (null when absent)"
feature: server-config
tags: [config, yaml, parsing, workspace-root, cwd, phase-6, issue-27]
---

## Given
- The branch `fix/27-workspace-root-session-cwd` is checked out and Phase 5 is fully merged.
- `@sumeru/server` already exposes a named export `loadConfig(path: string): Promise<InstanceConfig>` that returns a parsed `InstanceConfig` (see `config-load-yaml.md`).
- Issue #27 adds **one** top-level field — `workspaceRoot: string | null` — to `InstanceConfig`. No other config field changes.
- The field is **optional in YAML** (a config file without `workspaceRoot` continues to load) but the **TypeScript type is non-optional** — it is `workspaceRoot: string | null`, never `workspaceRoot?: string` (project rule: "no optional `?:` properties").
- `InstanceConfig` continues to be re-exported from `@sumeru/server`'s public `index.ts`.
- The test environment writes new fixtures alongside the existing ones in `packages/server/tests/fixtures/`:
  1. `sumeru.workspace-root.yaml` — the existing two-gateway shape **plus** `workspaceRoot: /tmp/sumeru-test-workspace` at the top level.
  2. `sumeru.workspace-root-empty.yaml` — `workspaceRoot: ""` (explicit empty string).
  3. `sumeru.workspace-root-not-string.yaml` — `workspaceRoot: 42` (wrong type).

## When
- Tests call:
  1. `await loadConfig("packages/server/tests/fixtures/sumeru.valid.yaml")` — pre-existing fixture, no `workspaceRoot` present.
  2. `await loadConfig("packages/server/tests/fixtures/sumeru.workspace-root.yaml")` — new fixture with `workspaceRoot: /tmp/sumeru-test-workspace`.
  3. `await loadConfig("packages/server/tests/fixtures/sumeru.workspace-root-empty.yaml")` — new fixture with `workspaceRoot: ""`.
  4. `await loadConfig("packages/server/tests/fixtures/sumeru.workspace-root-not-string.yaml")` — new fixture with `workspaceRoot: 42`.
- Existing tests in `packages/server/tests/config.test.ts` continue to run unchanged.

## Then
- **Case 1 (field absent)** — resolves to an `InstanceConfig` whose `workspaceRoot` is **`null`** (not `undefined`, not the empty string). The remaining keys (`name`, `gateways`) are exactly as they were before this issue — adding the new field does NOT alter them.
- **Case 2 (field present, non-empty string)** — resolves to an `InstanceConfig` with `workspaceRoot: "/tmp/sumeru-test-workspace"` (verbatim, no path resolution / `~` expansion / trimming applied at this layer — the value is stored exactly as the YAML provided).
- **Case 3 (field present, empty string)** — resolves with `workspaceRoot: null`. An empty string is treated as "operator did not configure one" so downstream code only has to branch on `null`, not on `null || ""`. (Mirrors how `name` rejects empty, but `workspaceRoot` is optional, so empty is folded to `null` instead of throwing.)
- **Case 4 (wrong type)** — `loadConfig` rejects with an `Error` whose `.message` includes:
  - the literal field name `workspaceRoot`, AND
  - the source file path,
  - and a hint such as `must be a string` or `must be a non-empty string`.
  No `InstanceConfig` is returned.
- **Type shape** — the exported `InstanceConfig` type is exactly:
  ```typescript
  type InstanceConfig = {
    name: string;
    workspaceRoot: string | null;
    gateways: Record<string, GatewayConfig>;
  };
  ```
  No `?:` modifier. Existing consumers reading `.name` / `.gateways` continue to compile (the change is additive).
- **Forward-compat preserved** — unknown top-level keys (the test for `sumeru.unknown-fields.yaml` already in the repo) still do NOT throw. `workspaceRoot` joins the small list of validated top-level fields, but unknown fields remain tolerated.
- **CLI consumes it** — `packages/cli/src/cli.ts` reads `cfg.workspaceRoot` from the loaded `InstanceConfig` and passes it through to `startServer({ workspaceRoot: cfg.workspaceRoot, ... })`. The CLI test continues to pass; if the CLI test imports `loadConfig` it sees the new field as `null` for fixtures that omit it.
- **Sample YAML updated** — the repo-root `sumeru.yaml` example file now includes a commented or uncommented `workspaceRoot:` line so operators have a copy-paste reference. The line is documented (`# workspaceRoot: /home/azureuser/repos`) and matches the issue's example.
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit 0. The new code uses no `class`, no `interface`, no default exports, and no optional `?:` properties.
