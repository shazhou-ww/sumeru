# syntax=docker/dockerfile:1
#
# Sumeru Claude Code adapter runtime image (v2).
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

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-claude-code/package.json ./adapter-claude-code/
COPY packages/adapter-claude-code/dist ./adapter-claude-code/dist/

# Workspace packages have no external runtime deps — link @sumeru/* for Node resolution.
RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-claude-code node_modules/@sumeru/adapter-claude-code

RUN chown -R node:node /opt/sumeru /usr/local/uv \
	&& mkdir -p /workspace && chown node:node /workspace

ENV HOME=/home/node
USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
