# syntax=docker/dockerfile:1
#
# Sumeru Cursor Agent adapter runtime image (v2).
# Built from monorepo dist/ artifacts — packages are not published to npm yet.
#
# Unlike the claude-code/codex adapters (npm install -g), cursor-agent is a
# self-contained package with its own bundled node runtime + native modules.
# Installed via the official https://cursor.com/install script.
FROM node:24-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		git \
		curl \
		ca-certificates \
		build-essential \
	&& rm -rf /var/lib/apt/lists/*

# Install cursor-agent CLI — self-contained package (not npm).
# The install script downloads to ~/.local/share/cursor-agent/ and symlinks
# to ~/.local/bin/. HOME is pinned to /home/node so the files land in the
# right place for the node user that runs the adapter at runtime.
ENV HOME=/home/node
ENV PATH="/home/node/.local/bin:${PATH}"
RUN mkdir -p /home/node/.local/bin /home/node/.local/share \
	&& curl -fsSL https://cursor.com/install | sh \
	&& chown -R node:node /home/node/.local \
	&& cursor-agent --version

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-cursor-agent/package.json ./adapter-cursor-agent/
COPY packages/adapter-cursor-agent/dist ./adapter-cursor-agent/dist/

# Workspace packages have no external runtime deps — link @sumeru/* for Node resolution.
RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-cursor-agent node_modules/@sumeru/adapter-cursor-agent

RUN chown -R node:node /opt/sumeru \
	&& mkdir -p /workspace && chown node:node /workspace \
	&& mkdir -p /home/node/.cursor && chown node:node /home/node/.cursor

# Sticky HOME — survives --user overrides (Docker resolves HOME from /etc/passwd
# for the numeric uid, which may differ when host passes --user).
ENV HOME=/home/node
USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
