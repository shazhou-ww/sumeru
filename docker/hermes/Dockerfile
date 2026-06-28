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
	&& uv pip install --python "$HERMES_VENV/bin/python" hermes-agent \
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

RUN chown -R node:node /opt/sumeru /opt/hermes-venv /usr/local/uv \
	&& mkdir -p /workspace && chown node:node /workspace

ENV HOME=/home/node
USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
