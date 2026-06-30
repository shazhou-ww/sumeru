# syntax=docker/dockerfile:1
#
# Sumeru Sarsapa adapter runtime image.
# Sarsapa is the native worker agent (芥子) — no external agent CLI,
# the agent loop (LLM call + tool exec) runs in-process via @sumeru/sarsapa.
# Only Node + ripgrep (for search_files) + basic build tools are needed.
# Built from monorepo dist/ artifacts — packages are not published to npm yet.
FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		git \
		curl \
		ca-certificates \
		build-essential \
		ripgrep \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/sarsapa/package.json ./adapter-sarsapa/
COPY packages/sarsapa/dist ./adapter-sarsapa/dist/

# Workspace packages have no external runtime deps — link @sumeru/* for Node resolution.
RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-sarsapa node_modules/@sumeru/sarsapa

RUN chown -R node:node /opt/sumeru \
	&& mkdir -p /workspace && chown node:node /workspace

# Sticky HOME — survives --user overrides (Docker resolves HOME from /etc/passwd).
ENV HOME=/home/node
USER node
WORKDIR /workspace

# Entrypoint contract: host does `docker exec <c> node /opt/sumeru/sarsapa/dist/main.js`
# feeding NDJSON on stdin (init + message frames), reading NDJSON on stdout.
CMD ["sleep", "infinity"]
