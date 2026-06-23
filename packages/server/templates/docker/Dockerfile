# syntax=docker/dockerfile:1
#
# Sumeru runtime image — self-contained, installed from npm.
#
# This image carries NO Sumeru source tree. `sumeru` is installed globally from
# the npm registry via `pnpm add -g @sumeru/cli`, which pulls @sumeru/server +
# the adapters + core transitively. The build context can therefore be empty —
# there is no COPY of any source or dist. All credentials, prompts, and user
# data are injected at run time (never baked into the image).
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
RUN pnpm add -g @sumeru/cli@${SUMERU_VERSION}

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
