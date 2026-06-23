---
"@sumeru/server": minor
---

Add Docker-mode orchestration assets (issue #84, Phase 1).

`@sumeru/server` now ships three literal templates under
`packages/server/templates/docker/` and exports a primitive to release them:

- `Dockerfile` — self-contained Node 22 image that installs Sumeru from npm
  (`pnpm add -g @sumeru/cli@${SUMERU_VERSION}`), carries no source `COPY`, and
  runs as a non-root `sumeru` user (fixed uid 10001), `EXPOSE 7900`.
- `docker-compose.yaml` — zero-render compose file driven entirely by
  compose-native `${VAR:-default}` interpolation: host-port mapping, the three
  mounts (named `sumeru-ocas` volume, `WORKSPACE` bind, read-only config), an
  optional `env_file` (`required: false`), and a curl healthcheck.
- `sumeru.env.example` — placeholder adapter credentials (`ANTHROPIC_API_KEY` /
  `ANTHROPIC_BASE_URL`), mirroring `deploy/sumeru.env.example`.

`materializeDockerAssets(targetDir: string): string[]` copies the three
templates byte-for-byte (no string rendering) into `targetDir`, resolving the
source directory relative to the compiled module location (not `process.cwd()`)
so it works from a globally-installed `@sumeru/cli`. It creates `targetDir`
recursively, is idempotent, and returns the written paths in stable order.

The package's `files` array now includes `"templates"` so the assets publish to
npm. The templates live outside `rootDir: src`, so `tsc` neither compiles nor
emits them.
