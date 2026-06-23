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

# Global package binaries live under /usr/local/share/pnpm so the non-root user
# can resolve `sumeru` on PATH at run time.
ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Sumeru from npm. No source COPY — buildable with an empty context.
RUN pnpm add -g @sumeru/cli@${SUMERU_VERSION}

# Non-root user with a fixed uid for host volume permission alignment.
RUN groupadd --gid 10001 sumeru \
	&& useradd --uid 10001 --gid 10001 --create-home --home-dir /home/sumeru sumeru

ENV HOME=/home/sumeru
WORKDIR /app

# Container-internal port (host port is mapped by compose). Matches the
# server's default listen port.
EXPOSE 7900

USER sumeru

# Bind to 0.0.0.0 inside the container so the compose port mapping can reach it.
ENTRYPOINT ["sumeru"]
CMD ["start", "-c", "/app/sumeru.yaml", "--host", "0.0.0.0"]
