# syntax=docker/dockerfile:1
#
# Sumeru base image — shared foundation for all adapter images.
# Contains: OS tools, Node 24, Python 3.12 (via uv), sudo, shared cache config.
# Adapter images (codex, hermes, sarsapa, etc.) extend this with their specific CLI.
FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		git \
		curl \
		ca-certificates \
		build-essential \
		ripgrep \
		sudo \
	&& echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
	&& rm -rf /var/lib/apt/lists/*

# Python via uv
ENV UV_PYTHON_INSTALL_DIR=/usr/local/uv/python
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
RUN uv python install 3.12 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python3 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python \
	&& ln -sf /usr/local/bin/uv /usr/local/bin/pip

# ── Shared cache + global install config ──────────────────────────────────
# Package manager caches → /cache (shared bind mount, cross-session)
ENV PNPM_STORE_DIR=/cache/pnpm-store
ENV NPM_CONFIG_CACHE=/cache/npm
ENV UV_CACHE_DIR=/cache/uv
ENV PIP_CACHE_DIR=/cache/pip

# Global install targets → HOME (persisted in container writable layer)
ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PYTHONUSERBASE=/home/node/.local
ENV PATH="$PNPM_HOME:/home/node/.npm-global/bin:/home/node/.local/bin:${PATH}"

# Prepare directories
RUN mkdir -p /home/node/.local/share/pnpm /home/node/.npm-global /home/node/.local/bin \
	&& chown -R node:node /home/node /usr/local/uv \
	&& mkdir -p /cache && chown node:node /cache \
	&& mkdir -p /workspace && chown node:node /workspace

# Sticky HOME — survives --user overrides
ENV HOME=/home/node
