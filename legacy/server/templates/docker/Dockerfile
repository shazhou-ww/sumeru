# syntax=docker/dockerfile:1
#
# Sumeru runtime image — self-contained, installed from npm.
#
# This image carries NO Sumeru source tree. `sumeru` is installed globally from
# the npm registry via `pnpm add -g @sumeru/cli`, which pulls @sumeru/server +
# the adapters + core transitively. The build context can therefore be empty —
# there is no COPY of any source or dist. All credentials, prompts, and user
# data are injected at run time (never baked into the image).
#
# On top of the thin Sumeru base this image carries a FOUNDATION TOOLCHAIN
# (RFC #99 P0, issue #102): build-essential, uv (Python multi-version, default
# 3.12) and nvm (Node multi-version, default 24 LTS). All toolchain installs
# run at BUILD TIME as root; the container still RUNS as the non-root uid 10001,
# so a sandboxed agent can switch Python/Node versions, install py/node packages
# and compile native extensions without any supervisor involvement. See
# specs/deploy/docker-toolchain-baseline.md for the behavior contract.
FROM node:22-slim

# Pin the published @sumeru/cli version for reproducible images. CI / release
# passes a concrete version; `latest` is the local-dev default.
ARG SUMERU_VERSION=latest

# Base tooling on PATH: git (agent workspaces) and curl (healthcheck probe).
# node + npm ship with the base image; pnpm is enabled via corepack below.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends git curl ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Global package binaries live under $PNPM_HOME/bin so the non-root user can
# resolve `sumeru` on PATH at run time. pnpm (≥10) places global bins in the
# `bin/` subdirectory of PNPM_HOME and REFUSES `pnpm add -g` unless that exact
# directory is on PATH — so it must be `$PNPM_HOME/bin`, not `$PNPM_HOME`, and
# the directory must pre-exist.
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME/bin:$PATH
RUN mkdir -p $PNPM_HOME/bin && corepack enable && corepack prepare pnpm@latest --activate

# Install Sumeru from npm. No source COPY — buildable with an empty context.
# The pnpm content-addressed store is cache-mounted (build-time only) so rebuilds
# reuse downloads; the cache never lands in a final image layer.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
	pnpm add -g @sumeru/cli@${SUMERU_VERSION}

# ─── Foundation toolchain (RFC #99 P0 / issue #102) — build-time, root ────────
# Inserted after the Sumeru install and before the non-root USER switch. These
# three blocks add the compile toolchain + Python (uv) + Node (nvm) multi-version
# managers. They are purely additive: the server's own reproducible install
# above is untouched, and the final USER / uid / ocas model below is unchanged.

# (1) Compile toolchain — source-compile native extensions (numpy/lxml/cffi/…).
# gcc/g++/make/libc headers. Required so a non-root agent can build C extensions
# at run time with no apt and no supervisor.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends build-essential \
	&& rm -rf /var/lib/apt/lists/*

# (2) uv — Python multi-version + venv + package installer. Default Python 3.12.
# The uv/uvx binaries are copied from the published image onto PATH. Managed
# CPython interpreters install into a SHARED dir (not a per-user ~/.local) so the
# non-root user can both use the default and add more versions at run time. The
# 3.12 interpreter is symlinked to `python`/`python3` on PATH so it resolves for
# non-login, non-interactive processes (an adapter `spawn`), not only login
# shells. Downloads ride a build-time cache mount.
ENV UV_PYTHON_INSTALL_DIR=/usr/local/uv/python
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
	uv python install 3.12 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python3 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python
# The managed-Python tree is the agent's DYNAMIC layer (it may add 3.11/3.13 at
# run time), so hand ownership to the non-root uid. Numeric id works before the
# user exists (created below).
RUN chown -R 10001:10001 /usr/local/uv

# (3) nvm — Node multi-version, for agents running user projects. Default 24 LTS.
# nvm installs into the SHARED /usr/local/nvm (world-reachable, NOT a per-user
# ~/.nvm). `nvm install 24` is pinned by major version (the contract is "default
# Node major == 24", independent of any LTS codename). The default 24 bin dir is
# exposed on PATH via a stable `default-bin` symlink + ENV so that a bare,
# non-login `node` (the shape an adapter spawns) resolves to v24 — NOT only a
# login shell sourcing /etc/profile. Tarball downloads ride a cache mount.
ENV NVM_DIR=/usr/local/nvm
RUN --mount=type=cache,target=/usr/local/nvm/.cache,sharing=locked \
	mkdir -p "$NVM_DIR" \
	&& curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
	&& . "$NVM_DIR/nvm.sh" \
	&& nvm install 24 \
	&& nvm alias default 24 \
	&& ln -sfn "$(dirname "$(nvm which default)")" "$NVM_DIR/default-bin"
# Hand the nvm tree (versions + aliases) to the non-root uid so the agent can
# `nvm install <ver>` at run time. Done in a separate layer with no cache mount
# present, so chown -R never recurses into the ephemeral download cache.
RUN chown -R 10001:10001 "$NVM_DIR"
# Default Node 24 first on PATH — inherited by EVERY process (login or not).
ENV PATH=/usr/local/nvm/default-bin:$PATH

# ─── Non-root runtime (unchanged by the toolchain additions) ──────────────────

# Non-root user with a fixed uid for host volume permission alignment.
RUN groupadd --gid 10001 sumeru \
	&& useradd --uid 10001 --gid 10001 --create-home --home-dir /home/sumeru sumeru

# Pre-create the ocas store dir owned by sumeru BEFORE switching USER. A Docker
# named volume mounted at /data/ocas inherits the mount-point's ownership from
# the image ONLY when the path pre-exists with the right owner; otherwise the
# fresh volume lands root:root and the non-root server hits "unable to open
# database file" → crash-loop. SUMERU_OCAS_DIR points here (compose also sets it).
RUN mkdir -p /data/ocas && chown -R sumeru:sumeru /data/ocas
ENV SUMERU_OCAS_DIR=/data/ocas

ENV HOME=/home/sumeru
WORKDIR /app

# Container-internal port (host port is mapped by compose). Matches the
# server's default listen port.
EXPOSE 7900

USER sumeru

# Bind to 0.0.0.0 inside the container so the compose port mapping can reach it.
ENTRYPOINT ["sumeru"]
CMD ["start", "-c", "/app/sumeru.yaml", "--host", "0.0.0.0"]
