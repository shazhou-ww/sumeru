# syntax=docker/dockerfile:1
#
# Sumeru Sarsapa adapter runtime image.
# Sarsapa is the native worker agent (芥子) — no external agent CLI,
# the agent loop runs in-process via @sumeru/sarsapa.
FROM sumeru/base:dev

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

RUN chown -R node:node /opt/sumeru

USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
