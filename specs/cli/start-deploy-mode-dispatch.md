---
scenario: "sumeru start -c <config> dispatches on the config's deploy.mode — absent/local keeps the existing local-process path (zero regression); docker materializes the packaged templates (reuse-don't-clobber), maps name/deploy.* onto compose env vars, and runs `docker compose -p <name> up -d --build` as a thin wrapper with stderr + exit-code passthrough"
feature: cli-start
tags: [cli, docker, deploy, deploy-mode, compose, dispatch, isolation, stderr-passthrough, phase-2, issue-85]
---

## Given

- The branch `fix/85-docker-phase-2` is checked out from `origin/main`; Phase 1 (#84) is already merged, so the following exist and are NOT modified by this issue:
  - `@sumeru/cli`'s `loadDeployConfig(path): Promise<DeployConfig>` (see `deploy-config-block.md`), where `DeployConfig = { mode: "docker" | "local"; port: number | null; workspace: string | null; image: string | null }` and absence of the `deploy:` block yields `{ mode: "local", port: null, workspace: null, image: null }`.
  - `@sumeru/server`'s `materializeDockerAssets(targetDir): string[]` (see `docker-materialize-assets.md`), which copies the three packaged templates (`Dockerfile`, `docker-compose.yaml`, `sumeru.env.example`) verbatim and **overwrites unconditionally**.
  - The shipped `docker-compose.yaml` template (see `docker-templates.md`), whose only interpolation points are compose-native `${SUMERU_VERSION:-latest}`, `${SUMERU_IMAGE:-sumeru:latest}`, `${SUMERU_PORT:-7900}`, `${WORKSPACE:-.}`, `${SUMERU_CONFIG:-./sumeru.yaml}`. The container-internal port is fixed at `7900`; the named volume is `sumeru-ocas`.
- `specs/architecture/docker-mode.md` is the design source of truth: "一份 config = 一个工作单元", deploy backend is the single source of truth (`deploy.mode`), and **there is NO `--docker` flag**.
- This issue adds a **CLI-side** launch path. The recommended shape (named exports, no default export, no `class`, no `interface`, no `?:` — project rules) is a new module `packages/cli/src/docker-launch.ts`:
  ```typescript
  // pure, unit-testable mapping (see Then "env mapping")
  export function buildComposeEnv(args: {
    name: string;
    configPath: string;       // the host path passed to `-c`
    deploy: DeployConfig;
  }): Record<string, string>;

  // availability probe; runner injectable for tests (defaults to node:child_process spawnSync)
  export function isDockerAvailable(run?: SpawnSyncFn): boolean;

  // full launch: probe → materialize-if-absent → spawn compose → resolve child exit code.
  // deps (spawnSync / spawn / materialize) injectable for unit tests.
  export function launchDockerCompose(
    args: { name: string; configPath: string; deploy: DeployConfig },
    deps?: DockerLaunchDeps,
  ): Promise<number>;
  ```
  The exact internal factoring is not mandated, but every observable contract in **Then** must hold.
- **Working-directory semantics (chosen):** the *unit directory* is the directory **containing the `-c` config file**. Templates are materialized there and `docker compose` runs with its child `cwd` set to that directory (so the thin wrapper needs no `-f`, and compose's relative bind mounts resolve against the unit dir per Compose v2). This keeps each unit self-contained next to its config and makes identity location-independent (identity comes from `-p <name>`, not CWD).
- An optional env override `SUMERU_DOCKER_BIN` (absent → the literal `docker`) selects the binary used for **both** the availability probe and the compose invocation. It exists for operators with a non-standard docker path and is the e2e test seam (point it at a fake executable that records argv + env and exits with a chosen code).
- Fixtures (Phase-1 ones already exist under `packages/cli/tests/fixtures/`): `sumeru.deploy-docker.yaml` (`name: alpha`, `deploy: { mode: docker, port: 7901, workspace: ~/units/alpha, image: sumeru:latest }`), `sumeru.deploy-local.yaml`, `sumeru.deploy-absent.yaml`.

## When

### When-1: local / absent → existing local path (zero regression)
- The operator runs `sumeru start -c <fixtures>/sumeru.deploy-absent.yaml` (no `deploy:` block), and separately `sumeru start -c <fixtures>/sumeru.deploy-local.yaml` (`deploy.mode: local`).

### When-2: docker → thin compose wrapper
- The operator runs `sumeru start -c <fixtures>/sumeru.deploy-docker.yaml` from an arbitrary directory, with `SUMERU_DOCKER_BIN` pointed at a fake `docker` that records `argv` + the child `env` to a file and exits `0`.

### When-3: pre-existing templates are reused, not clobbered
- The operator has previously emitted templates into the unit dir and hand-edited `docker-compose.yaml`. They run `sumeru start -c <unit>/sumeru.yaml` (docker mode) again.

### When-4: compose failure is surfaced verbatim
- The fake `docker` (or a real one with an already-bound port) exits non-zero and writes a diagnostic to its stderr.

### When-5 (Docker-gated): real multi-unit isolation
- Guarded by `SUMERU_DOCKER_INTEGRATION=1` (skipped, not failed, without Docker). With real Docker, the operator runs `sumeru start -c alpha.yaml` and `sumeru start -c beta.yaml` (distinct `name`, distinct `deploy.port`).

## Then

### Then-1: local / absent is byte-for-byte the old behavior
- For both When-1 invocations the CLI takes the **existing** local path: it writes the pid file (`cli-pid-file.md`), binds the local port (`cli-startup-port-check.md`), calls `startServer`, prints exactly `Listening on http://127.0.0.1:7900` (per `server-start-listens.md`), and `SIGINT` exits `0`.
- It does **not** probe Docker, **not** materialize templates, and **not** spawn `docker`. All pre-existing CLI tests (`start-graceful-shutdown`, `start-with-gateway-config`, `start-unknown-adapter`, `pid-file`, `port-check`, …) stay green unchanged. Absence of a `deploy:` block is exactly equivalent to `deploy.mode: local`.

### Then-2: docker dispatch runs the thin wrapper and exits with the child's code
- For When-2 the CLI does **not** write the local pid file, does **not** bind a local port, and does **not** call `startServer`. The host process is a launcher only.
- The recorded child argv is exactly:
  ```
  docker compose -p alpha up -d --build
  ```
  The project flag `-p alpha` (from `config.name`) is the **single** mechanism conveying unit identity — the template has no `SUMERU_PROJECT` token, so name is carried by `-p`, never an env var. (This faithfully realizes the issue's "name → SUMERU_PROJECT(=name)".)
- The child is spawned with `stdio: "inherit"` and its `cwd` is the unit dir (the directory of the `-c` config). The host process resolves the child's exit code and calls `process.exit(<code>)` — exit `0` on success.
- Before spawning, the three templates exist in the unit dir (materialized via `materializeDockerAssets` when absent).

### Then-3: env mapping (the `buildComposeEnv` contract)
- `buildComposeEnv` returns a map that, merged over `process.env`, sets exactly these unit-specific keys for the docker fixture (`name: alpha`, port `7901`, workspace `~/units/alpha`, image `sumeru:latest`):

  | env var | source | value for fixture |
  |---|---|---|
  | `SUMERU_PORT` | `deploy.port` (when non-null) | `"7901"` |
  | `WORKSPACE` | `deploy.workspace` with leading `~`/`~/` expanded to `os.homedir()` (when non-null) | `"<home>/units/alpha"` |
  | `SUMERU_IMAGE` | `deploy.image` (when non-null) | `"sumeru:latest"` |
  | `SUMERU_CONFIG` | the `-c` config path made relative to the unit dir | `"./sumeru.yaml"` (or the config's basename) |

  - `~` expansion happens **here** at launch time (Phase 1 deliberately stored `workspace` raw / unexpanded). A literal `~` must never reach Docker as a bind-mount source.
  - When a `deploy.*` field is `null`, its env var is **omitted** so the compose template's `${VAR:-default}` applies (e.g. no `deploy.port` → `SUMERU_PORT` unset → compose binds `7900`). `buildComposeEnv` bakes in **no** defaults itself (Phase-1 purity carries over).
  - The map is otherwise the inherited environment (so adapter creds / `PATH` survive into compose).

### Then-4: reuse-don't-clobber (When-3)
- The auto-start docker path materializes only **absent** template files; any of the three already present in the unit dir is left **byte-for-byte unchanged** (a hand-edited `docker-compose.yaml` survives). Because Phase-1 `materializeDockerAssets` overwrites unconditionally, the start path guards per file (e.g. write only missing ones / skip when present). If all three already exist, no template write happens at all.
- (Contrast: the explicit `--emit-assets` flow MAY overwrite — see `start-emit-assets.md`. The no-clobber rule is specific to the implicit auto-start materialize.)

### Then-5: stderr + exit-code passthrough (When-4)
- The compose child's stderr/stdout reach the operator's terminal **verbatim** (inherited stdio; no capture, no reformatting, no added `[sumeru]` prefix on compose output). A port-in-use or build error from compose is shown as compose wrote it.
- The host `sumeru start` exits with the **same** non-zero code the compose child returned. No Node stack trace from the launcher leaks for an ordinary compose failure.

### Then-6 (Docker-gated): real multi-unit isolation (When-5)
- Guarded by `SUMERU_DOCKER_INTEGRATION=1`; skipped (not failed) without Docker.
- After both units are up: `docker volume ls` lists **both** `alpha_sumeru-ocas` and `beta_sumeru-ocas` (project-prefixed named volumes — distinct stores).
- `curl -fsS http://127.0.0.1:<alpha.port>/` and `…:<beta.port>/` each return HTTP `200`; the two ports differ; `GET /` of each returns `name` equal to its own config (`alpha` vs `beta`). The two units' session data is mutually invisible.

### Then-7: build / quality gates
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. New code uses no `class`, no `interface`, no default exports, no optional `?:` properties; new file names are kebab-case (`docker-launch.ts`).
- A changeset under `.changeset/` bumps `@sumeru/cli` **minor** (additive `deploy.mode: docker` launch path).

## Non-goals

- **No** `--docker` flag and **no** new `--port` / `--workspace` passthrough flags — `deploy.*` in the config is the single source of truth.
- **No** re-implementation of Docker orchestration — the CLI is a thin wrapper over `docker compose`; it does not template, lint, or post-process the compose file beyond the `${VAR}` env it exports.
- **No** `stop` / `logs` / `down` subcommands (out of scope; the operator uses `docker compose -p <name> …` directly).
- **No** change to `materializeDockerAssets` (#84) or to `@sumeru/server`'s config loader.
- **No-Docker downgrade** error is specified separately in `start-docker-unavailable.md`; the `--emit-assets` materialize-and-exit flow in `start-emit-assets.md`.
