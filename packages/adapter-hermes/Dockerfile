# syntax=docker/dockerfile:1
#
# Sumeru Hermes adapter runtime image (v2).
# Built from monorepo dist/ artifacts — packages are not published to npm yet.
FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		git \
		curl \
		ca-certificates \
		build-essential \
	&& rm -rf /var/lib/apt/lists/*

ENV UV_PYTHON_INSTALL_DIR=/usr/local/uv/python
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/
RUN uv python install 3.12 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python3 \
	&& ln -sf "$(uv python find 3.12)" /usr/local/bin/python

# Hermes is a Python package — install into a shared venv accessible by non-root user.
ENV HERMES_VENV=/opt/hermes-venv
RUN uv venv "$HERMES_VENV" --python 3.12 \
	&& uv pip install --python "$HERMES_VENV/bin/python" "hermes-agent[acp]" \
	&& ln -sf "$HERMES_VENV/bin/hermes" /usr/local/bin/hermes

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-hermes/package.json ./adapter-hermes/
COPY packages/adapter-hermes/dist ./adapter-hermes/dist/

# Workspace packages have no external runtime deps — link @sumeru/* for Node resolution.
RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-hermes node_modules/@sumeru/adapter-hermes

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

RUN chown -R node:node /opt/sumeru /opt/hermes-venv /usr/local/uv \
	&& mkdir -p /workspace && chown node:node /workspace \
	&& mkdir -p /home/node/.hermes && chown node:node /home/node/.hermes \
	&& mkdir -p /home/node/.local/share/pnpm /home/node/.npm-global /home/node/.local/bin \
	&& chown -R node:node /home/node \
	&& mkdir -p /cache && chown node:node /cache

ENV HOME=/home/node
USER node
WORKDIR /opt/sumeru

# /workspace for user project files (mounted by host)
RUN mkdir -p /workspace

CMD ["sleep", "infinity"]
