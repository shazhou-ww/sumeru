---
scenario: "A SUMERU_DOCKER_INTEGRATION-gated suite drives the real Docker backend end-to-end on a host with Docker installed — building the self-contained image, starting a unit via `sumeru start -c <docker-config>`, exercising the live HTTP/SSE surface, and locking the three core contracts (multi-unit isolation, ocas persistence across `down`, non-fatal gateway degradation) plus the no-Docker downgrade. Without the env var the entire suite skips (green, not failed); CI never runs Docker."
feature: docker-mode-integration
tags: [docker, integration, gated, isolation, persistence, degradation, sse, export, no-docker, phase-3, issue-86]
---

## Given

- The branch `fix/86-docker-phase-3` is checked out from `origin/main`. Phase 1 (#84) and Phase 2 (#85) are **merged**, so the following already exist and are NOT modified by this issue:
  - `@sumeru/server`'s `materializeDockerAssets(targetDir): string[]` and the three packaged templates under `packages/server/templates/docker/` (`Dockerfile`, `docker-compose.yaml`, `sumeru.env.example`) — see `specs/deploy/docker-materialize-assets.md` / `specs/deploy/docker-templates.md`.
  - `@sumeru/cli`'s docker launch path (`packages/cli/src/docker-launch.ts`: `buildComposeEnv` / `isDockerAvailable` / `launchDockerCompose`) and the `start` dispatch on `deploy.mode` + `--emit-assets` — see `specs/cli/start-deploy-mode-dispatch.md`, `specs/cli/start-emit-assets.md`, `specs/cli/start-docker-unavailable.md`.
  - `@sumeru/cli`'s `loadDeployConfig(path): Promise<DeployConfig>` (`deploy-config.ts`) — see `specs/cli/deploy-config-block.md`.
- The design source of truth is `specs/architecture/docker-mode.md` (its "Tests（gated on Docker）" block enumerates exactly the eight behaviors locked here). This spec is the **executable** realization of that block; it adds NO new product behavior, only tests + the docs note (the latter owned by `specs/deploy/docker-mode-readme.md`).
- **This is Phase 3 —收尾**: the only production deliverable is tests; no `src/` change to `@sumeru/cli` or `@sumeru/server` is required or permitted by this spec (a test-only helper module is allowed). The bump is therefore `@sumeru/cli` **patch** (test-only; see Then-9).
- **Host assumption (NEKO-VM)**: the integration host has Docker ≥ 20.10 with Compose v2 (`docker compose version` works; NEKO has Docker 29.1.3). The CI runner does NOT (Non-goal), so the gate (Then-0) is the contract that keeps CI green.
- **Build is from the worktree's own packages, not npm**: `@sumeru/cli` is not yet published at the version under test. The image's `Dockerfile` installs `@sumeru/cli` from npm by design (self-contained), which is correct for released versions; for the integration build the suite passes `SUMERU_VERSION` such that `pnpm add -g @sumeru/cli@<version>` resolves to a published version whose behavior matches (the default `latest` is acceptable when the launch/asset contracts under test are already released). The suite asserts the image's **self-containment** (no source COPY) regardless of which published version it pins — see the build case. The suite does NOT depend on un-published code paths inside the container; the Phase-3 changes are test-only.

### Test file & gating

- The suite lives at `packages/cli/tests/docker-mode.test.ts` (sibling of the existing `start-docker-dispatch.test.ts`; picked up by the root `vitest.config.ts` `include: ["packages/*/tests/**/*.test.ts"]`).
- **Every** `describe`/`it` is wrapped by the gate. The mechanism is exactly:
  ```typescript
  const DOCKER_IT = process.env.SUMERU_DOCKER_INTEGRATION ? describe : describe.skip;
  // or, per the issue's wording, equivalently:
  describe.skipIf(!process.env.SUMERU_DOCKER_INTEGRATION)("docker mode (gated)", () => { … });
  ```
  No `it` runs real Docker outside the gate. There is NO top-level (un-gated) `await`/`spawn` of `docker` at module load — Docker is only touched inside gated test bodies (so importing the file on a Docker-less CI worker is inert).
- The suite drives the **built** CLI at `packages/cli/dist/cli.js` (resolved via `fileURLToPath(new URL("../dist/cli.js", import.meta.url))`, mirroring `start-docker-dispatch.test.ts`), spawned as a child with `SUMERU_PID_FILE` pointed at a temp path so no real pid file is written.

### Deterministic agent seam (no LLM, no creds)

- The SSE round-trip and persistence cases need an agent that produces turns **deterministically**, with no upstream model call. The seam is the existing `hermesBin` override forwarded through `gateways.<name>.config` (per `specs/cli/cli-pass-gateway-config.md`): a tiny fake `hermes` executable is bind-mounted into the container's `/workspace` and the config sets `gateways.hermes.config.hermesBin: /workspace/fake-hermes`. The image is unchanged; the fake rides in on the `WORKSPACE` bind mount.
- The fake `hermes` is a small Node/sh script that speaks the minimal `hermes chat` contract the adapter consumes (a session id on create; a short deterministic turn stream on send) — enough for `POST .../messages` to emit at least one `event: turn` and a terminal `event: done`. (If a real `hermes` binary is present in the image on the host, the suite MAY use it instead; the fake is the default so the suite is hermetic.)

### Config fixtures (written per-test into temp unit dirs)

Each case writes its own `sumeru.yaml` into a fresh `mkdtempSync` unit dir (the dir containing `-c` is the unit dir, per `start-deploy-mode-dispatch.md`). Canonical fixtures:

```yaml
# alpha.yaml — primary docker unit
name: alpha
workspaceRoot: /workspace
deploy:
  mode: docker
  port: 7901                 # host port; container-internal stays 7900
  workspace: <tmp-workspace> # bind-mounted to /workspace (holds fake-hermes)
gateways:
  hermes:
    adapter: hermes
    config:
      hermesBin: /workspace/fake-hermes
    capabilities: { resume: true, streaming: true }
```

```yaml
# beta.yaml — second unit, distinct name + port for the isolation case
name: beta
workspaceRoot: /workspace
deploy: { mode: docker, port: 7902, workspace: <tmp-workspace-beta> }
gateways:
  hermes:
    adapter: hermes
    config: { hermesBin: /workspace/fake-hermes }
    capabilities: { resume: true, streaming: true }
```

```yaml
# degraded.yaml — declares an adapter whose binary is absent in the image
name: degraded
workspaceRoot: /workspace
deploy: { mode: docker, port: 7903, workspace: <tmp-workspace> }
gateways:
  hermes:
    adapter: hermes
    config: { hermesBin: /workspace/fake-hermes }
    capabilities: { resume: true, streaming: true }
  claude-code:                # no `claude` binary in the base image
    adapter: claude-code
    capabilities: { resume: true, streaming: false }
```

### Cleanup discipline (anti-pollution)

- **After every gated case** the suite runs `docker compose -p <name> down -v` (volumes removed) so no project / named volume / container leaks between cases. This runs in `afterEach` (or a per-case `try/finally`) and is itself tolerant of "already gone".
- The **persistence** case deliberately runs `down` WITHOUT `-v` mid-body (that is the contract under test), then asserts, then ends with a final `down -v` to restore the clean slate.
- Host port numbers are unique per concurrently-live unit (alpha 7901 / beta 7902 / degraded 7903) so cases that co-reside don't collide. Cases run serially unless noted.
- A helper polls `GET /` until HTTP 200 (healthcheck warmup) with a bounded timeout (≤ 90 s for a cold `--build`, ≤ 30 s for an already-built image), failing the test with the collected `docker compose logs` on timeout.

## When

The gated suite runs (with `SUMERU_DOCKER_INTEGRATION=1` and Docker present) the eight behaviors below. Each `When-N` maps to one `Then-N`.

- **When-0 (gate):** the suite is imported and run with `SUMERU_DOCKER_INTEGRATION` **unset**.
- **When-1 (build / self-contained):** `materializeDockerAssets(unitDir)` then `docker compose -p <name> build` (or `docker build`) from the unit dir; afterwards `docker run --rm <image> node --version`.
- **When-2 (start + health):** `sumeru start -c alpha.yaml` (docker mode) → poll host `GET http://127.0.0.1:7901/`.
- **When-3 (SSE round-trip):** against the running alpha unit, `POST /gateways/hermes/sessions` then `POST /gateways/hermes/sessions/:id/messages` with `{ "content": "ping" }`, reading the `text/event-stream`.
- **When-4 (persistence across `down`):** on alpha, create a session + send (producing turns), capture an `export`, then `docker compose -p alpha down` (NO `-v`), then `sumeru start -c alpha.yaml` again, then re-query the old session.
- **When-5 (multi-unit isolation):** bring up `alpha` AND `beta` together; create a session on alpha; inspect `docker volume ls` and cross-query beta.
- **When-6 (export):** on the running alpha unit, `POST /gateways/hermes/sessions/:id/export`, capture the response body.
- **When-7 (degradation):** `sumeru start -c degraded.yaml` (declares `claude-code` with no `claude` binary), then `GET /gateways`.
- **When-8 (no Docker):** `sumeru start -c alpha.yaml` with `SUMERU_DOCKER_BIN` pointed at a non-existent path (Docker forced unavailable without mutating the real `PATH`).

## Then

### Then-0: the gate keeps the suite green without Docker (the load-bearing contract)

- With `SUMERU_DOCKER_INTEGRATION` unset, `npx vitest run` reports the docker-mode suite as **skipped**, exit code `0`. Zero `docker`/`docker compose` child processes are spawned. This is the contract that lets CI (no Docker) stay green while NEKO runs the full matrix.
- Skipped ≠ failed: a Docker-less run shows the cases as `skipped` in vitest output, never `failed`, and never `todo`-with-error. Importing the module performs no Docker side effect.

### Then-1: the image builds and is self-contained

- `docker compose -p <name> build` (or `docker build -t sumeru:latest`) exits `0`.
- `docker run --rm <image> node --version` prints `v22.*`.
- `docker run --rm <image> sh -lc 'command -v git && command -v node && command -v sumeru'` prints three absolute paths (`sumeru` from the global npm install).
- **Self-containment (asserted on the templates, not just the build):** the shipped `Dockerfile` contains **no** `COPY packages` / `COPY src` / `COPY dist` line (a regex scan of `packages/server/templates/docker/Dockerfile`), and the build succeeds with an **empty-ish build context** (only the three emitted assets in the unit dir). `docker run --rm <image> npm ls -g @sumeru/cli` lists a concrete version (the install came from npm, not a source tree).
- A missing adapter binary does NOT fail the build (adapter binaries are run-time `spawn` dependencies; the build never validates their presence).

### Then-2: a docker unit is a standard Sumeru endpoint

- After `sumeru start -c alpha.yaml`, host `GET http://127.0.0.1:7901/` returns HTTP `200` with the `@sumeru/instance` envelope `{ type: "@sumeru/instance", value: { name, version, gateways } }`, and `value.name === "alpha"` (identity from config, byte-identical to local mode).
- `docker compose -p alpha logs` contains the same startup line shape as local mode (`Listening on http://0.0.0.0:7900` inside the container; the host port is the compose mapping) and one `[sumeru] ocas store: /data/ocas` line (proving ocas lands on the volume, per `server-ocas-store-bootstrap.md`).
- The host launcher (`sumeru start`) exits `0` after the detached `up -d` returns; the container keeps running under compose.

### Then-3: SSE round-trip emits turn + done

- `POST /gateways/hermes/sessions` returns `201` with a `@sumeru/session` envelope (`value.id` matches `^ses_[0-9A-HJKMNP-TV-Z]{26}$`).
- `POST /gateways/hermes/sessions/:id/messages` with `{ "content": "ping" }` returns `Content-Type: text/event-stream` and a stream containing **at least one** `event: turn` and exactly one terminal `event: done` (the `done` payload carries the summary `{ turnCount, tokens, durationMs }` shape). The stream also carries `X-Accel-Buffering: no` (reverse-proxy friendly, per `server-message-sse-endpoint.md`) — identical to local mode.

### Then-4: ocas persists across `down` (no `-v`); only `-v` clears it

- Before teardown: capture the old session id `S`, its turn count `T`, and `export1 = POST .../sessions/S/export` (raw bytes).
- `docker compose -p alpha down` (NO `-v`) removes the container; `docker volume ls` STILL lists `alpha_sumeru-ocas`.
- After `sumeru start -c alpha.yaml` again and health-ready:
  - `GET /gateways/hermes/sessions/S` returns the original recording — same turn count `T`, same hashes, same order (rehydrated from the volume-backed ocas store).
  - A search recall works: `GET /gateways/hermes/sessions?q=<a keyword from the seeded turn>` (or `GET /sessions?q=…`) returns `S` in its `results` (content-addressed recall is restart-idempotent, per `server-search-endpoint.md`).
  - `export2 = POST .../sessions/S/export` carries the **same CAS closure** as `export1`: decompress (`gunzip`) and untar both, then compare the *entries* (each `cas/<hash>.bin` blob + `vars.jsonl` + `tags.jsonl`) by name + content. The recorded data is byte-identical across the restart (content-addressed recall is restart-idempotent, per `server-session-export-endpoint.md`). The compare is at the **entry** level, NOT the raw tar bytes: `@ocas/core`'s `packTar` stamps each tar header with a live `mtime` (`Date.now()`), so the tar envelope legitimately differs run-to-run while the payload is identical. Tar-level byte determinism is `@ocas/core`'s own contract — out of scope here, tracked separately as ocas#219 and guarded by its unit tests. The persistence contract THIS case owns is "the recorded data survives `down`", which lives in the entries.
- Only an explicit `docker compose -p alpha down -v` removes `alpha_sumeru-ocas` (asserted last): after `down -v`, `docker volume ls` no longer lists it, and a fresh start cannot recall `S`. `-v` semantics are Docker-native and not re-implemented.

### Then-5: multi-unit isolation (volume + port + session)

- With `alpha` and `beta` both up: `docker volume ls` lists **both** `alpha_sumeru-ocas` and `beta_sumeru-ocas` — two project-prefixed named volumes (the prefix is the compose project = config `name`, conveyed by `-p <name>`, never an env var).
- The two units listen on different host ports (7901 vs 7902); `GET /` on each returns `value.name` equal to its own config (`alpha` vs `beta`).
- A session created on alpha is **invisible** to beta: `GET http://127.0.0.1:7902/gateways/hermes/sessions/<alpha-session-id>` returns `404 session_not_found`, and beta's session list does not contain it. Two configs ⇒ two fully independent work units, with isolation coming from config identity alone (no extra orchestration).

### Then-6: export is deterministic with the documented layout

- `POST /gateways/hermes/sessions/:id/export` on the live container returns HTTP `200`, `Content-Type: application/gzip`, `Content-Disposition: attachment; filename="<sessionId>.tar.gz"`.
- Decompressing the body (`gunzip`) and listing the tar shows the `server-session-export-endpoint.md` layout: one `cas/<hash>.bin` per node in the closure, plus `vars.jsonl` and `tags.jsonl`. The export is built from the container's ocas store (which is the volume), so this is the same bytes a local-mode export of the same recording would produce.
- (Determinism across `down` is asserted in Then-4; this case asserts the single-shot shape + headers.)

### Then-7: a missing adapter binary degrades that gateway only (non-fatal)

- `sumeru start -c degraded.yaml` brings the unit up healthy (exit `0`, `GET /` 200) **despite** the `claude-code` gateway having no `claude` binary in the image.
- `GET /gateways` returns HTTP `200` with a `@sumeru/gateway-list` whose entry order matches the YAML; the `claude-code` entry has `status: "unavailable"` while the `hermes` entry has `status: "ready"` (per the degradation contract in `cli-pass-gateway-config.md` / the gateway-list shape in `server-gateways-list-endpoint.md`).
- The `hermes` gateway remains fully usable on the same instance (a `POST .../sessions` on it succeeds) — one unavailable gateway never drags down the others or the instance.

### Then-8: no Docker → exit 1 with the exact one-line message

- `sumeru start -c alpha.yaml` with `SUMERU_DOCKER_BIN` set to a non-existent path exits with code **`1`** and writes **exactly one** stderr line, byte-equal to:
  ```
  Docker is not available. Install Docker or set deploy.mode: local in your config.
  ```
  No Node stack trace, no `[sumeru]`-prefixed extra diagnostics, no fallback to the local path, no `docker compose` child, no template materialization. (This re-asserts `start-docker-unavailable.md` through the Phase-3 suite so the downgrade is covered end-to-end alongside the live cases; it does NOT require real Docker, but lives in the gated file for cohesion — it MAY also be left un-gated since it needs no daemon, at the implementer's discretion, as long as Then-0 still holds for the daemon-touching cases.)

### Then-9: zero regression + quality gates

- All pre-existing (non-Docker) tests pass unchanged: `npx vitest run` with `SUMERU_DOCKER_INTEGRATION` unset is fully green (the new suite skipped), including the existing `start-docker-dispatch.test.ts`, `start-docker-unavailable.test.ts`, `start-emit-assets.test.ts`, `deploy-config.test.ts`, and all server/adapter suites.
- `pnpm run build`, `pnpm run check`, `pnpm run typecheck` exit `0`. New test code (and any test-only helper module, e.g. `packages/cli/tests/helpers/docker.ts`) follows project rules: no `class`, no `interface`, no default export, no optional `?:` properties, `.js` import extensions, kebab-case filenames.
- A changeset under `.changeset/` records the Phase-3 work as `@sumeru/cli` **patch** (test + docs only; no shipped behavior change). The commit is a conventional commit `Fixes #86`, author `小橘 <xiaoju@shazhou.work>`.

## Non-goals

- **No** CI execution of the Docker integration suite — the gate (Then-0) keeps CI green; NEKO-local is the only place the gated cases run (issue Non-goal).
- **No** image signing / scanning (issue Non-goal; trust derives from the npm publish chain).
- **No** new product behavior — Phase 3 is tests + a README note. No `src/` change to `@sumeru/cli` / `@sumeru/server` is introduced here (a test-only helper is fine).
- **No** change to the templates, `materializeDockerAssets`, the launch path, or `loadDeployConfig` — those are Phase 1/2 and are merely exercised, not modified.
- **No** real-LLM dependency — the SSE/persistence cases use the deterministic fake-`hermes` seam; the suite needs no `ANTHROPIC_API_KEY` or network egress to upstream models.
- **No** Kubernetes / multi-host / horizontal-scale coverage (out of `docker-mode.md` scope).
- **No** new top-level runtime dependency — the suite uses `node:*` built-ins (`child_process`, `fs`, `os`, `path`, `zlib`) plus the already-present `@ocas/core` tar primitives for the export decode.
