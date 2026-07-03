# syntax=docker/dockerfile:1
#
# Sumeru Codex adapter runtime image.
FROM sumeru/base:dev

RUN npm install -g @openai/codex

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-codex/package.json ./adapter-codex/
COPY packages/adapter-codex/dist ./adapter-codex/dist/

RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-codex node_modules/@sumeru/adapter-codex

RUN chown -R node:node /opt/sumeru \
	&& mkdir -p /home/node/.codex && chown node:node /home/node/.codex

USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
