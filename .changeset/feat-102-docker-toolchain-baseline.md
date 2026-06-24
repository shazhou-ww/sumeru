---
"@sumeru/server": minor
"@sumeru/cli": patch
---

Docker foundation toolchain baseline (#102, RFC #99 P0): upgrade the packaged
runtime image from a thin base to a full workshop foundation.

The shipped `packages/server/templates/docker/Dockerfile` now installs, all at
build time as root, before the non-root `USER` switch:

- **build-essential** — so a sandboxed agent can source-compile native
  extensions (numpy / lxml / cffi …) at run time with no apt and no supervisor.
- **uv** — Python multi-version + venv + installer; default **Python 3.12**
  installed into a shared, uid-10001-owned tree and symlinked onto `PATH` so a
  bare non-login `python` resolves. Agents add 3.11 / 3.13 / … on demand.
- **nvm** — Node multi-version in the shared `/usr/local/nvm`; default
  **Node 24 LTS** (pinned by major: `nvm install 24`, not an LTS codename). The
  default Node 24 bin is prepended onto the base `PATH` via `ENV` so a bare,
  non-login `node` — the shape an adapter `spawn`s — lands on v24, not the
  `node:22-slim` base interpreter. The nvm tree is uid-10001-owned so agents
  `nvm install <ver>` more lines at run time.

The pnpm-store, uv, and nvm downloads ride BuildKit `--mount=type=cache`
(build-time only — no final image layer, zero run-time / isolation effect).

Two-layer model is unchanged: every toolchain install is build-time root; the
container still RUNS as the fixed non-root **uid 10001**. The change is purely
additive — self-containment (no source COPY), the ocas pre-create, the uid /
home / port model, and the HTTP/SSE contract are all untouched. The server's own
install (pnpm-global `@sumeru/cli`) stays reproducible and independent of the
nvm dynamic layer; running the server under Node 24 is safe because Sumeru has
no native-ABI dependency (its only persistence driver is the built-in
`node:sqlite`, and the rest of the tree — `@ocas/*`, `ajv`, `yaml` — is pure JS).

Tests: a new `SUMERU_DOCKER_INTEGRATION`-gated suite
(`packages/server/tests/docker-toolchain.test.ts`) — non-gated content
assertions on the Dockerfile (run in CI) plus gated real build / run probes
(default python 3.12 + node 24 incl. the non-login spawn shape, uv/nvm
multi-version switch, non-root native compile, uid 10001, server geo-layer
intact). The gate keeps CI green (skipped, never failed, no `docker` at import).
The `@sumeru/cli` bump is the test-only follow-through: the existing gated
`docker-mode.test.ts` default-`node` assertion moves v22 → v24 to match the new
image default.

Specs: new `specs/deploy/docker-toolchain-baseline.md` (behavior contract);
`specs/architecture/docker-mode.md` 「镜像内容契约」 table gains the foundation
toolchain + version/package-split rows and the default-node assertion updates to
v24. The run-time unit-internal cache volume (RFC #99 cache档1) is deferred to a
follow-up issue as a compose-template concern orthogonal to this Dockerfile
baseline.

Ref #102 #99.
