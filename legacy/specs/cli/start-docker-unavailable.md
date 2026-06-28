---
scenario: "When a config declares deploy.mode: docker but Docker is unavailable (binary not on PATH, or `docker info` exits non-zero), sumeru start exits code 1 with one exact stderr line and no stack trace, no fallback to local mode, and no compose invocation"
feature: cli-start
tags: [cli, docker, downgrade, availability, exit-code, no-fallback, phase-2, issue-85]
---

## Given

- The branch `fix/85-docker-phase-2` is checked out from `origin/main`. The deploy-mode launch path is defined in `start-deploy-mode-dispatch.md`; this spec pins its failure branch.
- Docker availability is probed via `spawnSync(<docker-bin>, ["info"], { stdio: "ignore" })` (the issue's stated mechanism). Two unavailability cases are equivalent:
  1. **binary missing** — spawn errors with `ENOENT` (docker not on `PATH`), or
  2. **daemon down / unusable** — the process spawns but exits with `status !== 0` (e.g. `docker info` fails to reach the daemon).
- `<docker-bin>` is `process.env.SUMERU_DOCKER_BIN ?? "docker"` (same seam as `start-deploy-mode-dispatch.md`), so tests can force unavailability by pointing it at a non-existent path or at a fake that exits non-zero — without mutating the real `PATH`.
- The probe lives behind a pure, injectable helper (e.g. `isDockerAvailable(run?: SpawnSyncFn): boolean`) so a unit test can assert both branches deterministically (inject a runner returning `{ error: ENOENT }` and one returning `{ status: 1 }`).
- The exact downgrade message (verbatim, the issue's wording) is:
  ```
  Docker is not available. Install Docker or set deploy.mode: local in your config.
  ```

## When

### When-1: docker binary not on PATH
- The operator runs `sumeru start -c <fixtures>/sumeru.deploy-docker.yaml` (`deploy.mode: docker`) on a machine where `docker` is not installed — emulated by `SUMERU_DOCKER_BIN` pointing at a non-existent path (spawn → `ENOENT`).

### When-2: docker present but `docker info` fails
- The operator runs the same command where `docker` exists but the daemon is unreachable — emulated by `SUMERU_DOCKER_BIN` pointing at a fake that exits with status `1` for `info`.

### When-3: local config is unaffected
- The operator runs `sumeru start -c <fixtures>/sumeru.deploy-local.yaml` (and `sumeru.deploy-absent.yaml`) on the same Docker-less machine.

## Then

### Then-1: exact downgrade, exit 1, no stack trace (When-1 & When-2)
- Both When-1 and When-2 produce identical behavior:
  - the process exits with code **`1`**,
  - stderr contains **exactly one line**, byte-equal to:
    ```
    Docker is not available. Install Docker or set deploy.mode: local in your config.
    ```
  - **no** Node stack trace, **no** `[sumeru]`-prefixed extra diagnostics, **no** `Failed to start server:` wrapper — just the one line.
- The probe failure is detected **before** any compose spawn and before any template materialization that would otherwise run on the launch path, so no `docker compose …` child is ever created and no partial side effects occur.

### Then-2: no fallback to local
- The CLI does **not** silently fall back to the local-process path: it does not write a pid file, does not bind a port, and does not call `startServer`. `deploy.mode: docker` with no Docker is a hard, documented stop — the operator must install Docker or edit the config. (This is why the message names the `deploy.mode: local` remedy explicitly.)

### Then-3: local mode never probes Docker (When-3)
- For `deploy.mode: local` and for an absent `deploy:` block, `sumeru start` runs the normal local path on a Docker-less machine with **zero** Docker interaction — it neither probes nor errors. The downgrade message appears **only** for `deploy.mode: docker`. This guarantees the no-Docker downgrade cannot regress local startup.

### Then-4: build / quality gates
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. A unit test drives `isDockerAvailable` with both injected failures (`ENOENT` and `status: 1`) and the success case (`status: 0`), asserting `false / false / true`. The end-to-end downgrade message + exit code is asserted via spawning the built CLI with `SUMERU_DOCKER_BIN` set to a missing/failing binary.
- No `class` / `interface` / default export / optional `?:`; helpers are kebab-case. Covered by the shared `@sumeru/cli` **minor** changeset for issue #85.

## Non-goals

- **No** auto-install of Docker, **no** retry/backoff, **no** prompt — a single line and exit `1`.
- **No** change to the local path's own diagnostics (port-in-use, pid-file) — those remain as specified in `cli-startup-port-check.md` / `cli-pid-file.md`.
- **No** Docker-version assertion (e.g. Compose v2 presence) here — `docker info` success is the availability bar; finer compose-version diagnostics are out of scope.
- **No** coverage of the successful launch path or env mapping — see `start-deploy-mode-dispatch.md`.
