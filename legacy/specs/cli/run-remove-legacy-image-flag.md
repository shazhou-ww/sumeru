---
scenario: "The legacy `-i, --image` option on the placeholder `sumeru run` command is removed — deploy.image in the config is the single source of truth for the Docker image, so a stray per-invocation image flag (a second source) is deleted to avoid the dual-source ambiguity the docker-mode redirect eliminated"
feature: cli-run
tags: [cli, run, cleanup, legacy-flag, image, single-source, phase-2, issue-85]
---

## Given

- The branch `fix/85-docker-phase-2` is checked out from `origin/main`.
- `packages/cli/src/cli.ts` currently registers a placeholder `run` command (`sumeru run — not yet implemented`) that still carries a legacy `-i, --image <image>` option:
  ```typescript
  program
    .command("run")
    .description("[planned] Run a scene with a specified adapter and model")
    .requiredOption("-s, --scene <path>", "Path to scene directory or YAML")
    .requiredOption("-r, --runner <type>", "Adapter type (hermes, claude-code)")
    .requiredOption("-m, --model <model>", "Model identifier")
    .option("-t, --timeout <seconds>", "Timeout in seconds", "300")
    .option("--network", "Allow network access", true)
    .option("--no-network", "Disable network access")
    .option("-i, --image <image>", "Docker image")     // ← legacy, to be removed
    .option("-o, --output <path>", "Output path for recording")
    .action(async (opts) => { /* prints "not yet implemented" */ });
  ```
- The docker-mode redirect (#89, see `specs/architecture/docker-mode.md` Non-goals) established that the Docker image is declared by `deploy.image` in the config (single source of truth), not by an ad-hoc command-line flag. Issue #85 deliverable 4 is to remove this leftover `-i, --image` residue so no second image source survives.
- `sumeru run` itself remains an unimplemented placeholder (the issue's Non-goals: "不实现 sumeru run <scene>"). This spec only deletes the stray flag; it does **not** implement `run`.

## When
- The contributor removes the `.option("-i, --image <image>", "Docker image")` line from the `run` command registration in `packages/cli/src/cli.ts` and rebuilds (`pnpm run build`).
- An operator runs `sumeru run --help`.
- An operator runs `sumeru run -i sumeru:latest -s ./scene -r hermes -m foo` (the now-removed flag).

## Then

### Then-1: flag is gone from help
- `sumeru run --help` output contains **no** `-i` and **no** `--image` entry. The remaining options (`-s/--scene`, `-r/--runner`, `-m/--model`, `-t/--timeout`, `--network/--no-network`, `-o/--output`) are still listed unchanged.
- A grep of `packages/cli/src/cli.ts` for `--image` and for `"Docker image"` returns **no** match.

### Then-2: passing the removed flag is rejected
- `sumeru run -i sumeru:latest …` exits non-zero — commander reports an unknown option `-i / --image` on stderr (commander's standard `error: unknown option` path), rather than silently accepting it. (The command still otherwise prints its "not yet implemented" placeholder only when invoked with valid options.)

### Then-3: no other command regresses
- The `start` command and its options (`--port`, `--host`, `--config`, `--ocas-dir`, `--force`, and the new `--emit-assets` from `start-emit-assets.md`) are untouched by this removal.
- The `list` placeholder command is untouched.
- Note: `-i` is freed up on `run`; nothing in this issue reuses it.

### Then-4: build / quality gates
- `pnpm run build`, `pnpm run check`, `pnpm run test` exit `0`. No `class` / `interface` / default export / optional `?:` introduced (a deletion). Covered by the shared `@sumeru/cli` **minor** changeset for issue #85 (the cleanup ships with the docker-phase-2 feature; no separate bump).

## Non-goals

- **No** implementation of `sumeru run <scene>` — it stays a placeholder (issue Non-goals).
- **No** removal of the other `run` placeholder options (`--scene` / `--runner` / `--model` / `--timeout` / `--network` / `--output`) — only the image flag, which conflicts with the `deploy.image` single-source rule, is deleted.
- **No** reintroduction of any image flag elsewhere — image selection is config-only via `deploy.image` (see `deploy-config-block.md` / `start-deploy-mode-dispatch.md`).
