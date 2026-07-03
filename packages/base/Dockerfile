# syntax=docker/dockerfile:1
#
# Sumeru base image — shared foundation for all adapter images.
# Intentionally uses a single RUN to minimize layer count (3 layers total:
# node:24-slim base + 1 RUN + COPY uv). Adapters inherit and add 1-2 layers.
FROM node:24-slim

# uv binary (single layer via COPY)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Everything else in ONE RUN to keep layer count at 1
RUN set -eux \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends \
		git curl ca-certificates build-essential ripgrep sudo \
	&& echo "node ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers \
	&& rm -rf /var/lib/apt/lists/* \
	# Python via uv
	&& export UV_PYTHON_INSTALL_DIR=/usr/local/uv/python \
	&& uv python install 3.12 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python3 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python \
	&& ln -sf /usr/local/bin/uv /usr/local/bin/pip \
	# Directories
	&& mkdir -p /home/node/.local/share/pnpm /home/node/.npm-global /home/node/.local/bin \
	&& chown -R node:node /home/node /usr/local/uv \
	&& mkdir -p /cache && chown node:node /cache \
	&& mkdir -p /workspace && chown node:node /workspace

# ENV declarations (0 layers — metadata only)
ENV UV_PYTHON_INSTALL_DIR=/usr/local/uv/python
ENV PNPM_STORE_DIR=/cache/pnpm-store
ENV NPM_CONFIG_CACHE=/cache/npm
ENV UV_CACHE_DIR=/cache/uv
ENV PIP_CACHE_DIR=/cache/pip
ENV PNPM_HOME=/home/node/.local/share/pnpm
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PYTHONUSERBASE=/home/node/.local
ENV PATH="$PNPM_HOME:/home/node/.npm-global/bin:/home/node/.local/bin:${PATH}"
ENV HOME=/home/node
