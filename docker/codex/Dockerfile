# syntax=docker/dockerfile:1
#
# Sumeru Codex adapter runtime image (v2).
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

RUN npm install -g @openai/codex

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-codex/package.json ./adapter-codex/
COPY packages/adapter-codex/dist ./adapter-codex/dist/

# Workspace packages have no external runtime deps — link @sumeru/* for Node resolution.
RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-codex node_modules/@sumeru/adapter-codex

# Use the built-in node user (uid 1000) from node:24-slim.
# Most Linux hosts have uid 1000 as first user — volume files align naturally.
RUN chown -R node:node /opt/sumeru /usr/local/uv \
	&& mkdir -p /workspace && chown node:node /workspace \
	&& mkdir -p /home/node/.codex && chown node:node /home/node/.codex

# Sticky HOME — survives --user overrides (Docker resolves HOME from /etc/passwd
# for the numeric uid, which may differ when host passes --user).
ENV HOME=/home/node
USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
