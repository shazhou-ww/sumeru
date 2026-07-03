# syntax=docker/dockerfile:1
#
# Sumeru Claude Code adapter runtime image.
FROM sumeru/base:dev

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-claude-code/package.json ./adapter-claude-code/
COPY packages/adapter-claude-code/dist ./adapter-claude-code/dist/

RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-claude-code node_modules/@sumeru/adapter-claude-code

RUN chown -R node:node /opt/sumeru \
	&& mkdir -p /home/node/.claude && chown node:node /home/node/.claude

USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
