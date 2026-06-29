---
scenario: "A sumeru.yaml with a deploy: block is parsed in layers — @sumeru/server's loadConfig ignores deploy entirely (server runtime sees only name/workspaceRoot/gateways), while the CLI parses deploy.mode/port/workspace/image into a typed DeployConfig"
feature: deploy-config
tags: [docker, deploy, config, layering, cli, forward-compat, phase-1, issue-84]
---

## Given

- The branch `fix/84-docker-phase-1` is checked out from `origin/main`; the design spec `specs/architecture/docker-mode.md` (post-#89 redirect) is the source of truth for the `deploy:` contract.
- `@sumeru/server` already exposes `loadConfig(path: string): Promise<InstanceConfig>` (see `config-load-yaml.md` / `config-load-workspace-root.md`). Its current behavior:
  - validates only the top-level keys `name`, `workspaceRoot`, `gateways`,
  - tolerates **unknown top-level keys** for forward-compatibility (they do NOT throw),
  - returns `InstanceConfig = { name: string; workspaceRoot: string | null; gateways: Record<string, GatewayConfig> }`.
- The `@sumeru/cli` package already declares `yaml` in its `dependencies`, so it can parse YAML without a new dependency.
- This issue adds a **CLI-side** module `packages/cli/src/deploy-config.ts` that defines and parses the optional top-level `deploy:` block. **`@sumeru/server` is NOT modified** — `deploy` remains an unknown key that `loadConfig` silently ignores. Responsibilities do not bleed: the server runtime never sees deployment metadata.
- The CLI exposes a named export (no default exports, project rule):
  ```typescript
  // packages/cli/src/deploy-config.ts
  export type DeployConfig = {
    mode: "docker" | "local";   // absent → "local"
    port: number | null;        // host port; absent → null (compose applies 7900 default later)
    workspace: string | null;   // host workdir → bind-mounted /workspace; absent/"" → null
    image: string | null;       // image tag; absent/"" → null
  };
  export function loadDeployConfig(path: string): Promise<DeployConfig>;
  ```
  No optional `?:` properties — every field is present, with `T | null` used for "operator did not configure one". `mode` is the only field that defaults to a non-null value (`"local"`).
- New fixtures live under `packages/cli/tests/fixtures/` (alongside any existing CLI fixtures):
  1. `sumeru.deploy-docker.yaml` — a valid two-gateway config **plus**:
     ```yaml
     name: alpha
     workspaceRoot: /workspace
     deploy:
       mode: docker
       port: 7901
       workspace: ~/units/alpha
       image: sumeru:latest
     gateways:
       hermes:
         adapter: hermes
         capabilities: { resume: true, streaming: true }
     ```
  2. `sumeru.deploy-local.yaml` — same shape but `deploy: { mode: local }` (no port/workspace/image).
  3. `sumeru.deploy-absent.yaml` — a valid config with **no** `deploy:` block at all (e.g. the existing `name`+`gateways` shape).
  4. `sumeru.deploy-bad-mode.yaml` — `deploy: { mode: kubernetes }` (unsupported mode string).
  5. `sumeru.deploy-bad-port.yaml` — `deploy: { mode: docker, port: "lots" }` (non-number port).
  6. `sumeru.deploy-not-mapping.yaml` — `deploy: [1, 2]` (array instead of mapping).

## When

- A test loads each fixture through **both** layers and compares:
  1. `await loadConfig("…/sumeru.deploy-docker.yaml")` — the existing server loader.
  2. `await loadDeployConfig("…/sumeru.deploy-docker.yaml")` — the new CLI parser.
- A test calls `loadDeployConfig` against each of fixtures 2–6.
- The existing CLI start flow is exercised: `packages/cli/src/cli.ts` continues to call `loadConfig` for the server-bound `InstanceConfig` (unchanged), and may additionally call `loadDeployConfig` for the deployment manifest.

## Then

### Server layer ignores `deploy` (no regression, no leak)

- `loadConfig("…/sumeru.deploy-docker.yaml")` resolves successfully (the `deploy:` block does **not** cause a throw — forward-compat tolerance already covers it).
- The returned `InstanceConfig` contains **exactly** `name`, `workspaceRoot`, `gateways` and nothing else:
  - `result.name === "alpha"`, `result.workspaceRoot === "/workspace"`, `result.gateways` has the `hermes` entry.
  - `"deploy" in result === false` — the deploy block never enters the server runtime object.
- The exported `InstanceConfig` **type is unchanged** — it gains no `deploy` field. The **config-loading path is untouched**: `packages/server/src/config.ts` and `packages/server/src/types.ts` are byte-identical to `origin/main` (assert via `git diff --quiet origin/main -- packages/server/src/config.ts packages/server/src/types.ts`). This is the real "server ignores deploy" invariant — it scopes to the loader + type, **not** to the whole `packages/server/src/` tree. (Other files in that tree legitimately change for sibling deliverables — e.g. `index.ts` gains the `materializeDockerAssets` re-export and `docker-assets.ts` is added per `docker-materialize-assets.md`; those are orthogonal to deploy-config layering and do NOT touch `config.ts`/`types.ts`.)

### CLI layer parses `deploy`

- `loadDeployConfig("…/sumeru.deploy-docker.yaml")` resolves to exactly:
  ```typescript
  { mode: "docker", port: 7901, workspace: "~/units/alpha", image: "sumeru:latest" }
  ```
  The `workspace` value is stored verbatim — **no** `~` expansion / path resolution at this layer (mirrors how `workspaceRoot` is stored raw).
- **Case 2 (`mode: local`, others absent)** → `{ mode: "local", port: null, workspace: null, image: null }`.
- **Case 3 (no `deploy:` block)** → the default local unit `{ mode: "local", port: null, workspace: null, image: null }` (absence is equivalent to `deploy.mode: local`; `sumeru start` stays on the local path with zero regression).
- **Case 4 (`mode: kubernetes`)** → rejects with an `Error` whose `.message` includes the field name `deploy.mode`, the offending value, the allowed set (`docker` / `local`), and the source file path.
- **Case 5 (`port: "lots"`)** → rejects with an `Error` mentioning `deploy.port`, `must be a number` (or `integer`), and the source path. (A valid port is an integer in `1..65535`; out-of-range numbers are likewise rejected with the same field name.)
- **Case 6 (`deploy: [1,2]`)** → rejects with an `Error` mentioning `deploy`, `must be a mapping`, and the source path.
- An empty-string `workspace` or `image` folds to `null` (operator-did-not-configure semantics), never the empty string.
- `loadDeployConfig` never returns `null`/`undefined` — on error it throws; on success it returns a fully-populated `DeployConfig`.

### Defaults belong to compose, not the parser (Phase-1 purity)

- `loadDeployConfig` does **not** bake in the `7900` port default or the `sumeru:latest` image default; absent values stay `null`. The `${VAR:-default}` substitution is the compose template's job (see `docker-templates.md`), keeping the parser a pure structural reader with no rendering logic.

### Build / quality gates

- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit `0`.
- New code uses no `class`, no `interface`, no default exports, and no optional `?:` properties; file name is kebab-case (`deploy-config.ts`).
- A changeset exists under `.changeset/` bumping `@sumeru/cli` **minor** (the new `DeployConfig` parser is an additive CLI feature). See `docker-templates.md` for the paired `@sumeru/server` minor bump.

## Non-goals

- **No** launch logic — `loadDeployConfig` only parses; wiring `deploy.mode: docker` into an actual `docker compose up` is Phase 2.
- **No** `--docker` flag and no new `--port/--workspace` passthrough flags — `deploy.*` in the config is the single source of truth.
- **No** change to `@sumeru/server`'s **config-loading path** (`config.ts` / `types.ts`) — the server-ignores-deploy guarantee is satisfied by the *existing* forward-compat behavior, asserted (not implemented) here. (`@sumeru/server` does gain the unrelated `materializeDockerAssets` export per `docker-materialize-assets.md`; that is out of scope for this spec and does not touch the loader.)
