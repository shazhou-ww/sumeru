---
scenario: "sumeru start -c <config> --emit-assets only releases the three packaged Docker templates into the unit directory and exits 0 — it never probes Docker, binds a port, calls startServer, or runs `docker compose up` — feeding the manual `docker compose -p <name> up -d --build` flow"
feature: cli-start
tags: [cli, docker, emit-assets, materialize, templates, no-launch, phase-2, issue-85]
---

## Given

- The branch `fix/85-docker-phase-2` is checked out from `origin/main`; Phase 1 (#84) is merged, so `@sumeru/server`'s `materializeDockerAssets(targetDir): string[]` and the three packaged templates (`Dockerfile`, `docker-compose.yaml`, `sumeru.env.example`) already exist (see `docker-materialize-assets.md` / `docker-templates.md`).
- This issue adds a new boolean flag to the `start` command:
  ```
  --emit-assets    Release the Docker compose templates next to the config, then exit (do not launch)
  ```
  registered on the existing `program.command("start")` in `packages/cli/src/cli.ts` (a plain commander `.option("--emit-assets", …)`, default `false`).
- `--emit-assets` requires `-c <config>` to resolve the **unit directory** (the directory containing the config file) — that is where templates are written, matching the auto-start docker path in `start-deploy-mode-dispatch.md`. Identity / target location come from the config, never from CWD.
- `--emit-assets` is **deploy-mode-agnostic**: it serves the manual `docker compose` flow, so it materializes regardless of whether the config's `deploy.mode` is `docker`, `local`, or absent. (It is the operator's explicit request to emit; the deploy block need not say `docker`.)

## When

### When-1: emit into a unit dir with no templates yet
- The operator runs `sumeru start -c <unit>/sumeru.yaml --emit-assets` where `<unit>/` contains only the config.

### When-2: emit is explicit overwrite (refresh)
- The operator has an older, hand-edited `docker-compose.yaml` in `<unit>/` and runs `sumeru start -c <unit>/sumeru.yaml --emit-assets` again.

### When-3: emit without `-c`
- The operator runs `sumeru start --emit-assets` with no `-c`.

## Then

### Then-1: exactly materialize-and-exit
- After When-1 the three files exist in `<unit>/`:
  - `<unit>/Dockerfile`
  - `<unit>/docker-compose.yaml`
  - `<unit>/sumeru.env.example`
  Each is **byte-identical** to its source under `packages/server/templates/docker/` (zero render — inherited from `materializeDockerAssets`).
- The command prints the list of written paths (one per line, or an equivalent `[sumeru] wrote <path>` line per file) to stdout, then exits `0`.
- The command **does not**:
  - probe Docker (no `docker info` / `docker compose` spawn),
  - write the local pid file or bind any TCP port,
  - call `startServer` (no `Listening on …` line),
  - run `docker compose up` (no container is created).
  `--emit-assets` is a pure side-effecting file emit + exit; it short-circuits **before** any deploy-mode dispatch.

### Then-2: explicit emit MAY overwrite (refresh semantics)
- For When-2, `--emit-assets` re-releases all three templates, **overwriting** the hand-edited `docker-compose.yaml` back to the packaged bytes. This is the deliberate contrast with the implicit auto-start path's reuse-don't-clobber rule (`start-deploy-mode-dispatch.md` Then-4): the operator asked explicitly to emit, so a refresh is expected. (Exit `0`.)

### Then-3: `--emit-assets` without `-c` is a clean usage error
- For When-3 the command exits non-zero (`1`) with a single stderr line stating that `--emit-assets` requires `-c <config>` to choose the target directory. No stack trace; no partial write to CWD.

### Then-4: help + flag surface
- `sumeru start --help` lists `--emit-assets` with a one-line description, alongside the existing `--port` / `--host` / `--config` / `--ocas-dir` / `--force` options.
- `--emit-assets` composes with the manual flow: after emitting, the documented next step is `docker compose -p <name> up -d --build` from `<unit>/` (the `-p <name>` mirrors `start-deploy-mode-dispatch.md`). This spec asserts the emit half only; it does not launch.

### Then-5: build / quality gates
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. New code adds no `class` / `interface` / default export / optional `?:`. The flag wiring lives in the existing kebab-case `cli.ts`; any helper is kebab-case too.
- Covered by the shared `@sumeru/cli` **minor** changeset for issue #85 (see `start-deploy-mode-dispatch.md` Then-7) — no separate bump.

## Non-goals

- **No** launch / `docker compose up` — that is the deploy-mode auto-start path (`start-deploy-mode-dispatch.md`). `--emit-assets` is the manual-flow escape hatch and stops after writing files.
- **No** Docker availability probe — emitting files needs no Docker; the no-Docker downgrade (`start-docker-unavailable.md`) applies only to the launch path.
- **No** new template content or `materializeDockerAssets` change — this flag is a thin call site over the Phase-1 primitive.
- **No** `--emit-assets` value/argument — it is a pure boolean flag; the target dir derives from `-c`.
