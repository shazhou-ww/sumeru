# syntax=docker/dockerfile:1
#
# Sumeru Codex adapter runtime image.
# Installs Codex CLI + adapter dist. Adds 2 layers on top of base.
FROM sumeru/base:dev
RUN npm install -g @openai/codex \
	&& mkdir -p /home/node/.codex && chown node:node /home/node/.codex
COPY --chown=node:node packages/core/dist /home/node/adapter/core/dist
COPY --chown=node:node packages/core/package.json /home/node/adapter/core/package.json
COPY --chown=node:node packages/adapter-core/dist /home/node/adapter/adapter-core/dist
COPY --chown=node:node packages/adapter-core/package.json /home/node/adapter/adapter-core/package.json
COPY --chown=node:node packages/adapter-codex/dist /home/node/adapter/adapter-codex/dist
COPY --chown=node:node packages/adapter-codex/package.json /home/node/adapter/adapter-codex/package.json
RUN cd /home/node/adapter && mkdir -p node_modules/@sumeru \
	&& ln -s /home/node/adapter/core node_modules/@sumeru/core \
	&& ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /home/node/adapter/adapter-codex node_modules/@sumeru/adapter-codex \
	&& ln -s /home/node/adapter/adapter-codex/dist/main.js /home/node/.local/bin/sumeru-adapter \
	&& chmod +x /home/node/adapter/adapter-codex/dist/main.js
USER node
WORKDIR /workspace
LABEL sumeru.harness="codex"
CMD ["sleep", "infinity"]
