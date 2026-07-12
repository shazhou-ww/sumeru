# syntax=docker/dockerfile:1
#
# Sumeru Claude Code adapter runtime image.
# Installs Claude Code CLI + adapter dist. Adds 2 layers on top of base.
FROM sumeru/base:dev
RUN npm install -g @anthropic-ai/claude-code \
	&& mkdir -p /home/node/.claude && chown node:node /home/node/.claude
COPY --chown=node:node packages/core/dist /home/node/adapter/core/dist
COPY --chown=node:node packages/core/package.json /home/node/adapter/core/package.json
COPY --chown=node:node packages/adapter-core/dist /home/node/adapter/adapter-core/dist
COPY --chown=node:node packages/adapter-core/package.json /home/node/adapter/adapter-core/package.json
COPY --chown=node:node packages/adapter-claude-code/dist /home/node/adapter/adapter-claude-code/dist
COPY --chown=node:node packages/adapter-claude-code/package.json /home/node/adapter/adapter-claude-code/package.json
RUN cd /home/node/adapter && mkdir -p node_modules/@sumeru \
	&& ln -s /home/node/adapter/core node_modules/@sumeru/core \
	&& ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /home/node/adapter/adapter-claude-code node_modules/@sumeru/adapter-claude-code \
	&& ln -s /home/node/adapter/adapter-claude-code/dist/main.js /home/node/.local/bin/sumeru-adapter \
	&& chmod +x /home/node/adapter/adapter-claude-code/dist/main.js
USER node
WORKDIR /workspace
LABEL sumeru.harness="claude-code"
CMD ["sleep", "infinity"]
