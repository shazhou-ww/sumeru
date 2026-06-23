---
scenario: "Three Docker orchestration templates ship inside @sumeru/server — a self-contained Dockerfile (pnpm add -g @sumeru/cli, no source COPY), a docker-compose.yaml driven entirely by compose-native ${VAR:-default} interpolation, and a sumeru.env.example credential template — and they are excluded from tsc but included in the published package"
feature: docker-templates
tags: [docker, templates, dockerfile, compose, self-contained, packaging, phase-1, issue-84]
---

## Given

- The branch `fix/84-docker-phase-1` is checked out; `specs/architecture/docker-mode.md` (post-#89) defines the image / storage / interpolation contracts these templates implement.
- A new directory `packages/server/templates/docker/` holds three **literal, non-`.ts`** files (no template engine, no rendering — all variability is compose-native env interpolation):
  - `Dockerfile`
  - `docker-compose.yaml`
  - `sumeru.env.example`
- Because `packages/server/tsconfig.json` has `"include": ["src"]` and `"rootDir": "src"`, the `templates/` directory lives **outside** the TypeScript compile graph — `tsc` neither compiles nor emits it. No tsconfig change is required to exclude it; this spec asserts that invariant.
- `@sumeru/server`'s `package.json` `files` array currently contains only `"dist"`. This issue adds `"templates"` so the three files publish to npm.
- The existing `deploy/sumeru.env.example` (systemd / local counterpart) is the model for the Docker `sumeru.env.example` credential template.

## When

- The contributor runs `pnpm run build` from the repo root.
- A test inspects the on-disk contents of `packages/server/templates/docker/*`.
- A reviewer runs `npm pack --dry-run` (or `pnpm pack`) inside `packages/server/`.
- (Docker-gated) An operator runs `docker build` against the `Dockerfile` and `docker compose -f docker-compose.yaml config` against the compose file.

## Then

### `Dockerfile` — self-contained, npm-distributed, non-root

- Starts `FROM node:22-slim` (matches the project Runtime: Node.js 22).
- Declares `ARG SUMERU_VERSION` (default `latest`) and installs Sumeru **from npm**:
  `RUN pnpm add -g @sumeru/cli@${SUMERU_VERSION}` — pulling `@sumeru/server` + adapters + core transitively. The entrypoint is the global `sumeru` command.
- **Self-containment (hard contract):** the `Dockerfile` contains **no** `COPY packages` and no `COPY` of any Sumeru source tree or `dist/`. A test greps the file and asserts `COPY packages` and `COPY . ` are absent. The image is buildable with an empty build context.
- Pre-installs base tooling on `PATH`: `git`, `curl` (healthcheck probe), `node`, and `pnpm` (and/or `npm`).
- Creates and runs as a **non-root** user `sumeru` with a fixed `uid 10001` (for host volume permission alignment). The final `USER` directive is `sumeru` (or `10001`), not root.
- `EXPOSE 7900` (the container-internal port, matching `server-start-listens.md`'s default).
- Carries **no** credentials, prompts, or user data — all injected at runtime.

### `docker-compose.yaml` — zero-render, compose-native interpolation

- Defines a single Sumeru service whose image source is **either**:
  - a `build:` section pointing at the sibling `Dockerfile` with `args: { SUMERU_VERSION: "${SUMERU_VERSION:-latest}" }`, **or**
  - `image: "${SUMERU_IMAGE:-sumeru:latest}"`.
- `ports: ["${SUMERU_PORT:-7900}:7900"]` — host port from `deploy.port`, container port fixed at `7900`.
- `volumes` declares exactly these three mounts:
  - `sumeru-ocas:/data/ocas` — a **named volume** (so a project prefix yields `<name>_sumeru-ocas`).
  - `${WORKSPACE:-.}:/workspace` — bind mount of the host workdir from `deploy.workspace`.
  - `${SUMERU_CONFIG:-./sumeru.yaml}:/app/sumeru.yaml:ro` — the config, mounted **read-only**.
- `env_file:` is the long-form mapping `{ path: ./sumeru.env, required: false }` so a missing credentials file is **not** fatal (hermes-only nodes start fine).
- `environment:` passes `SUMERU_OCAS_DIR=/data/ocas` (so ocas lands on the volume, per `server-ocas-store-bootstrap.md`) and `HOME=/home/sumeru`.
- A top-level `volumes:` key declares the named volume `sumeru-ocas`.
- Declares a `healthcheck` that polls `curl -fsS http://127.0.0.1:7900/` on an interval (e.g. every 10s).
- Contains **only** compose-native `${VAR:-default}` interpolation — **no** moustache / handlebars / `<placeholder>` tokens. A test asserts the file parses as valid YAML and contains no `{{` / `}}` rendering markers. (`materializeDockerAssets` copies it byte-for-byte; see `docker-materialize-assets.md`.)

### `sumeru.env.example` — credential template

- Contains placeholder, **non-secret** adapter credentials in env-file format (`KEY=value`, no `export`, no quotes), e.g. `ANTHROPIC_API_KEY=` and `ANTHROPIC_BASE_URL=` matching the keys in `deploy/sumeru.env.example`.
- Carries a header comment instructing the operator to copy it to `sumeru.env`, `chmod 600`, and fill real values; and noting that `sumeru.env` must never be committed (only the `.example` lives in the repo).

### tsc exclusion + packaging

- After `pnpm run build`, no `.js`/`.d.ts` is emitted for anything under `packages/server/templates/` (it is outside `rootDir: src`). `packages/server/dist/` contains **no** `templates` subtree.
- `packages/server/package.json` `files` now lists `["dist", "templates"]`.
- `npm pack --dry-run` in `packages/server/` lists all three files — `templates/docker/Dockerfile`, `templates/docker/docker-compose.yaml`, `templates/docker/sumeru.env.example` — in the package tarball.

### Docker-gated assertions (skipped without Docker)

- Guarded by `SUMERU_DOCKER_INTEGRATION=1`; when Docker is absent the whole block **skips** (not fails):
  - `docker build -f packages/server/templates/docker/Dockerfile -t sumeru:test .` exits `0` with an empty/minimal context (proves no source COPY).
  - `docker run --rm sumeru:test node --version` prints `v22.*`.
  - `docker run --rm sumeru:test sh -lc 'command -v git && command -v curl && command -v sumeru'` prints three absolute paths.

### Build / quality gates

- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. (Biome does not lint the non-`.ts` template files; if it would, they are added to `biome.json` ignore.)
- A changeset under `.changeset/` bumps `@sumeru/server` **minor** (new shipped templates + `files` entry). See `docker-materialize-assets.md` for the paired export.

## Non-goals

- **No** `materializeDockerAssets` implementation here — that export is specified in `docker-materialize-assets.md`. This spec only fixes the template **contents** and their **packaging**.
- **No** template rendering engine — variability is 100% compose-native `${VAR:-default}`.
- **No** `docker compose up` / launch behavior (Phase 2) and **no** integration tests across the full API (Phase 3).
- **No** pinning of adapter binary versions inside the image beyond `ARG SUMERU_VERSION` for `@sumeru/cli`.
