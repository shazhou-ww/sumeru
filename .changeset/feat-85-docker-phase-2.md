---
"@sumeru/cli": minor
"@sumeru/server": patch
---

Docker Phase 2 (#85): `sumeru start -c <config>` dispatches on `deploy.mode`.

- `deploy.mode: docker` launches `docker compose -p <name> up -d --build` (thin
  wrapper, identity via `-p <name>`, `~` expansion, reuse-don't-clobber template
  materialization); `local`/absent falls through to the existing local path
  (zero regression).
- `--emit-assets` releases the compose templates next to the config and exits.
- No-Docker downgrade: a `docker` config on a Docker-less host exits 1 with a
  single-line message, no stack trace, no fallback.
- Removes the legacy `-i, --image` flag from `run` (superseded by `deploy.image`).
- Fixes two Docker image template bugs surfaced by Phase 2's real `up` (Phase 1
  only built the old COPY image): pnpm global-bin PATH must be `$PNPM_HOME/bin`
  (else `pnpm add -g` refuses), and `/data/ocas` must be pre-created + chowned to
  the non-root `sumeru` user (else the fresh named volume lands root:root and the
  server crash-loops on "unable to open database file").
