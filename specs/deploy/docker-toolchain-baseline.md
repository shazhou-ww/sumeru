---
scenario: "The Sumeru runtime image upgrades from a thin base to a full workshop foundation: build-time (root) it installs build-essential, uv (default Python 3.12), and nvm (default Node 24 LTS) so that at run time a non-root agent (uid 10001) can switch Python/Node versions on demand, install arbitrary py/node packages, and compile native extensions — all inside the sandbox, with the non-root isolation and the server's own reproducible Node install left untouched. pnpm/uv/nvm downloads ride BuildKit cache mounts (build-time only, zero isolation impact)."
feature: docker-toolchain-baseline
tags: [docker, toolchain, uv, nvm, python, node, build-essential, native-extensions, non-root, buildkit-cache, gated, p0, issue-102, rfc-99]
---

## Given

- The branch `fix/102-docker-toolchain-baseline` is checked out from `origin/main`. This is **RFC #99 Phase P0** — the pure foundation layer: zero dependencies, pure upside. It does NOT touch the install-approval gate (P1, depends on #36/#95) nor the registry mirror (P2).
- The image being upgraded is the **single** packaged Dockerfile at `packages/server/templates/docker/Dockerfile` (shipped inside `@sumeru/server`, per `specs/deploy/docker-templates.md`). No other Dockerfile exists.
- The pre-#102 Dockerfile (the baseline this issue extends, NOT modifies destructively) already establishes:
  - `# syntax=docker/dockerfile:1` on line 1 → **BuildKit is enabled by default** (Docker ≥ 23), so `--mount=type=cache` is available without any extra flag.
  - `FROM node:22-slim` → the base image's Node 22 at `/usr/local/bin/node` is the **server's own (geo-layer) Node** — installed via `pnpm add -g @sumeru/cli@${SUMERU_VERSION}`, locked and reproducible.
  - base apt tooling: `git`, `curl`, `ca-certificates`.
  - `ENV PNPM_HOME=/usr/local/share/pnpm` + `ENV PATH=$PNPM_HOME/bin:$PATH`; corepack-enabled pnpm; `RUN pnpm add -g @sumeru/cli@${SUMERU_VERSION}`.
  - non-root user `sumeru` (`uid 10001`, `gid 10001`, home `/home/sumeru`); `/data/ocas` pre-created + `chown`ed; `ENV SUMERU_OCAS_DIR=/data/ocas`; `ENV HOME=/home/sumeru`; `WORKDIR /app`; `EXPOSE 7900`; `USER sumeru`; `ENTRYPOINT ["sumeru"]` / `CMD ["start", "-c", "/app/sumeru.yaml", "--host", "0.0.0.0"]`.
- The design source of truth is RFC **#99 §5-A** (foundation toolchain) + issue **#102** (the change list). This spec is the executable behavior contract for that change list.

### The version/package binary split (RFC #99 Principle A)

| Layer | Content | When fixed | Mutability |
|-------|---------|------------|-----------|
| **Foundation (地基层)** | python/node **versions** + package managers (uv / pnpm) + compile toolchain | build time | immutable, reproducible |
| **Dynamic (动态层)** | the concrete **packages** an agent installs (pip / npm) at run time | run time | free, lands in the sandbox's private layer |

The image fixes "the toolchain at known versions"; concrete packages are left to the agent at run time. **Versions can be pinned, packages are not.**

### Two-layer permission boundary (unchanged by P0)

- **Build time = root** — every `apt` / toolchain install runs as root during build.
- **Run time = non-root** — the container still runs as `uid 10001`. Isolation is **not** broken. (System-library `apt` approval at run time is P1, NOT in scope here; this phase needs no supervisor involvement.)

### The three Dockerfile additions (build-time, root)

Inserted **after** the existing `FROM node:22-slim` + git/curl/pnpm/`pnpm add -g` blocks and **before** `USER sumeru`:

1. **Compile toolchain** — required to source-compile native extensions (numpy / lxml / cffi …):
   ```dockerfile
   RUN apt-get update && apt-get install -y --no-install-recommends \
         build-essential \
       && rm -rf /var/lib/apt/lists/*
   ```
2. **uv** — Python multi-version + venv + package installer. Default **3.12**:
   ```dockerfile
   COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
   RUN uv python install 3.12
   ```
3. **nvm** — Node multi-version (for agents running user projects in the workspace). Default **24 LTS** (codename Jod):
   ```dockerfile
   ENV NVM_DIR=/usr/local/nvm
   RUN mkdir -p $NVM_DIR \
       && curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
       && . $NVM_DIR/nvm.sh && nvm install 24 && nvm alias default 24
   ```
   - nvm installs into the **shared** `/usr/local/nvm` (world-readable, NOT a per-user `~/.nvm`), so the non-root `uid 10001` user can reach it. The shared tree is `chown`ed to `uid 10001` at build time so the run-time non-root agent can `nvm install <ver>` more versions on demand.
   - Pinned by **major version** (`nvm install 24`), NOT an LTS codename — the contract is "default Node major == 24". (The codename "Jod" is in fact Node **22**'s LTS line, not 24's, so a `--lts=Jod` form would silently install the wrong major; issue #102's own snippet uses `nvm install 24`.)

### BuildKit cache mounts (change ②, build-time only, zero isolation impact)

The `pnpm add -g @sumeru/cli` line plus the uv and nvm download steps each carry a `--mount=type=cache` so re-builds reuse downloaded artifacts. These caches exist **only during the build** — they are never part of the final image layers and have **zero** run-time / isolation effect. Example:
```dockerfile
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
      pnpm add -g @sumeru/cli@${SUMERU_VERSION}
```
(uv → `target=/root/.cache/uv`; nvm/node tarball downloads → a cache under `$NVM_DIR/.cache`. The exact targets are the implementer's to verify against each tool's real cache dir; the contract is "the three downloads are cache-mounted and the build still produces a byte-correct image".)

## When

### When-1: build the image
- `docker compose -p <name> build` (or `docker build -t sumeru:latest -f packages/server/templates/docker/Dockerfile .`) from a unit dir / minimal context.

### When-2: probe default versions (non-interactive exec)
- `docker run --rm <image> sh -lc 'python --version'`
- `docker run --rm <image> sh -lc 'node --version'`
- `docker run --rm <image> node --version` — a **direct, non-login, non-interactive** exec (this is the spawn shape an adapter uses; it does NOT source `/etc/profile`).

### When-3: uv multi-version on demand
- `docker run --rm <image> sh -lc 'uv python install 3.11 && uv run -p 3.11 python --version'`

### When-4: nvm multi-version on demand
- `docker run --rm <image> sh -lc '. $NVM_DIR/nvm.sh && nvm install 20 && nvm use 20 && node -v'`

### When-5: native extension compiles (as the non-root user)
- `docker run --rm <image> sh -lc 'uv pip install --system --python 3.12 cffi'` (or an equivalent small C-extension package), run as the default `uid 10001` user.

### When-6: non-root identity unchanged
- `docker run --rm <image> id -u`

### When-7: server geo-layer intact + no regression
- `docker run --rm <image> sh -lc 'command -v git && command -v node && command -v sumeru'`
- `docker run --rm <image> npm ls -g @sumeru/cli`
- the existing `specs/integration/docker-mode-integration.md` gated suite (build / start+health / SSE round-trip / persistence / isolation / export / degradation / no-Docker) is re-run against the upgraded image.

## Then

### Then-1: the image builds successfully
- When-1 exits `0`. The three new blocks (build-essential, uv, nvm) all install during the **build (root)** phase; no `apt`/toolchain step runs at run time.
- Self-containment is **preserved**: the Dockerfile still contains **no** `COPY packages` / `COPY src` / `COPY dist` (the toolchain additions pull from apt / `ghcr.io/astral-sh/uv` / the nvm install script, never from a Sumeru source tree). The build still succeeds from a minimal context.

### Then-2: default Python 3.12 and default Node 24 — including non-interactive spawn
- `sh -lc 'python --version'` → `Python 3.12.*`.
- `sh -lc 'node --version'` → `v24.*`.
- **`node --version` (direct non-login exec, When-2 line 3) → `v24.*`** — the default Node resolves on the container's base `PATH`, NOT only inside a login shell. This is the load-bearing assertion: an adapter that `spawn`s a process (non-login, non-interactive) MUST land on the default Node 24, otherwise agents running user projects get the wrong (or no) Node. See **Notes** for why this distinguishes a correct implementation from a profile.d-only one.
- `python` / `python3` and `node` are resolvable on `PATH` for the default `uid 10001` user without any manual `source`/`nvm use`.

### Then-3: uv switches Python versions on demand (predictable, fast)
- When-3 prints `Python 3.11.*`. `uv python install 3.11` fetches a **pre-built binary** (no source compile of CPython), so the switch is seconds, not a build. The agent can pull any other version the same way (`uv python install 3.13`, etc.).
- PEP 668 ("externally-managed-environment") does **not** block the agent: uv manages its own interpreters / venvs and bypasses the Debian system-pip wall.

### Then-4: nvm switches Node versions on demand
- When-4 prints `v20.*`. From the shared `/usr/local/nvm`, the non-root user can `nvm install <ver> && nvm use <ver>` to reach Node 18/20/22/etc. for user projects.
- Switching the nvm-active Node, or changing the nvm default, is the **dynamic layer** — it is independent of the server's geo-layer Node (Then-7).

### Then-5: native C-extensions compile under the non-root user
- When-5 succeeds (exit `0`): a package with a C extension (e.g. `cffi`) builds from source, proving (a) `build-essential` is present and (b) the **non-root** `uid 10001` user can compile — no root, no supervisor, no `apt` at run time. This is the user-visible payoff of the foundation layer.

### Then-6: non-root identity is unchanged
- When-6 prints exactly `10001`. The image still runs as the fixed non-root uid; the toolchain additions (all build-time root) do **not** alter the final `USER`, the uid, the home dir, or the `/data/ocas` ownership pre-creation. Isolation is intact.

### Then-7: the server's geo-layer Node stays reproducible and independent
- The `sumeru` server's install is untouched: `npm ls -g @sumeru/cli` still lists the pinned `SUMERU_VERSION`, `command -v sumeru` still resolves to the global pnpm bin, and `command -v git`/`node` print absolute paths.
- The **foundation Node (server) and the dynamic Node (nvm) are independent**: changing the nvm default/active Node does not change the `@sumeru/cli` install nor break server startup. The mechanism that keeps the server reproducible while making Node 24 the agent default is the implementer's choice (see Notes), but the contract is: **the server still starts and serves the standard Sumeru endpoint** after the toolchain upgrade.
- **No regression** in the live surface: the `specs/integration/docker-mode-integration.md` gated suite (start + health, SSE turn/done round-trip, ocas persistence across `down`, multi-unit isolation, export, gateway degradation, no-Docker downgrade) passes unchanged against the upgraded image — the toolchain layer adds capability without changing any HTTP/SSE contract.

### Then-8: build-time cache mounts, no isolation impact
- The `pnpm add -g`, uv, and nvm download steps each use `--mount=type=cache`. A second `docker build` reuses the cached downloads (observably faster on the cached steps) and produces a functionally identical image.
- The cache mounts are **build-time only**: they appear in no final image layer, are not present at run time, and create no cross-container or cross-unit shared writable surface. Zero isolation impact (RFC #99: read/build-time sharing does not break the sandbox; only a run-time writable shared surface would).

### Then-9: gated tests + quality gates
- New Docker assertions live behind the existing **`SUMERU_DOCKER_INTEGRATION=1`** gate (the same mechanism as `specs/integration/docker-mode-integration.md` / `specs/deploy/docker-templates.md`). With the env var **unset**, every toolchain case **skips** (vitest reports `skipped`, exit `0`) — never `failed`. CI (no Docker) stays green; the real build/run cases execute only on a Docker host (e.g. NEKO-VM). There is no top-level (un-gated) `docker` spawn at module load.
- The default-version assertions (Then-2), uv/nvm multi-version (Then-3/4), native-compile (Then-5), uid (Then-6), and geo-layer (Then-7) are all driven through `docker run` / `docker compose` inside gated test bodies.
- `pnpm run build`, `pnpm run check`, `pnpm run test`, `pnpm run typecheck` all exit `0`. Any new test/helper code follows project rules: no `class`, no `interface`, no default export, no optional `?:`, `.js` import extensions, kebab-case filenames.
- A changeset under `.changeset/` records the work as **`@sumeru/server` minor** (a new shipped capability in the packaged Dockerfile template — the toolchain baseline). The commit is a conventional commit `Fixes #102` (Ref #99), author `小橘 <xiaoju@shazhou.work>`.

### Then-10: the docker-mode contract table reflects the new baseline
- `specs/architecture/docker-mode.md`'s 「镜像内容契约」 table 「基础工具」 row (and/or new adjacent rows) now lists the foundation toolchain: `python (uv, 默认 3.12)`, `node 多版本 (nvm, 默认 24 LTS)`, and `build-essential` — so the architecture spec and this behavior spec agree on what the image guarantees. (Done in this same change; see that file's diff.)

## Notes

- **Why the non-interactive-spawn PATH assertion (Then-2) is the crux.** `/etc/profile.d/*.sh` is sourced only by **login** shells. Adapters spawn agent/tool processes **non-login, non-interactively** (e.g. `spawn('node', …)` or `spawn('some-cli')`), which do **not** source profile.d. So a profile.d-only nvm setup would make `sh -lc 'node'` → v24 but a bare spawned `node` → the base image's v22 (or unresolved) — a silent split. The robust fix is to put the default Node 24 `bin` directory on the container's **base `PATH` via `ENV`** (inherited by every process, login or not). The implementer MUST verify both shapes (`sh -lc 'node -v'` AND direct `node -v`) return v24 — that is exactly the open implementation question issue #102 flags ("通过 ENV 注入 default 版本的 bin 到 PATH,或在 /etc/profile.d/ 写 nvm source（实现时验证哪种对非交互式 spawn 也生效）").
- **Server-Node vs agent-Node (resolved: global `ENV` prepend is safe here).** Making Node 24 the agent default while keeping the `sumeru` server reproducible is the one real tension in P0. The implementation prepends the default Node 24 bin onto the base `PATH` via `ENV` (the spawn-safe option above), which means the `sumeru` process — whose shebang is `#!/usr/bin/env -S node …` — *also* executes under Node 24 rather than the `node:22-slim` base interpreter. This is safe because Sumeru has **no native-ABI dependency**: its only persistence driver is the built-in **`node:sqlite`** (`DatabaseSync`, "zero native build deps"), which ships inside the Node binary itself (and is more mature in 24 than in the still-experimental 22), and the rest of the dependency tree (`@ocas/*`, `ajv`, `yaml`) is pure JS. So there is no compiled-against-22 `.node` addon to break under 24. Independence still holds at the layer that matters: changing the **nvm-active / nvm-default** Node (the dynamic layer) does not touch the pnpm-global `@sumeru/cli` install (the geo layer) — `npm ls -g` lists the pinned version and the server still starts and serves (Then-7). The base image stays `FROM node:22-slim` (the reproducible floor); the agent-facing default is Node 24 by `PATH` order.
- **nvm version pinning (by major, not codename).** `nvm install 24` installs the latest Node 24 line; `nvm alias default 24` pins the default. Pinning by **major version** is deliberate: nvm LTS codenames are easy to get wrong (the codename "Jod" is Node **22**'s LTS line, not 24's — a `--lts=Jod` form would silently install Node 22 and contradict every `Then` here). The contract is "default Node major == 24", not a specific patch.
- **uv `:latest` in `COPY --from`.** The Dockerfile pulls `ghcr.io/astral-sh/uv:latest`. This is acceptable for the dev-default image; CI/release reproducibility for uv itself (pinning a uv tag) is a follow-up hardening, not a P0 blocker (out of scope, like the existing `SUMERU_VERSION=latest` default).

## Non-goals

- **No** install-approval gate / `apt` at run time (RFC #99 P1, depends on #36 permission-request + #95 suspend pipe). This phase needs no supervisor involvement.
- **No** registry mirror / cross-unit download dedup (RFC #99 P2), and **no** cross-unit shared writable store + hardlink (RFC #99 P3, opt-in).
- **No** unit-internal run-time cache volume (RFC #99 cache档1, `<name>_sumeru-cache`). Although issue #102 lists it as an optional "顺手" item, it is a **compose-template** concern orthogonal to the Dockerfile toolchain baseline, and the issue explicitly permits splitting it out ("可拆到独立小 issue,P0 只保 ①+②"). To keep P0 a minimal, pure-upside Dockerfile change, it is **deferred to a separate follow-up issue**. (The build-time BuildKit cache mounts — change ② — ARE in scope; only the run-time named-volume cache is deferred.)
- **No** change to the HTTP/SSE API surface, the compose template's service/volume/port contract, `materializeDockerAssets`, the launch path, or the non-root/uid/ocas model — the toolchain layer is purely additive.
- **No** pinning of every toolchain sub-version beyond the stated defaults (Python 3.12, Node 24); agents pull other versions at run time on demand.
