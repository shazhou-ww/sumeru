# syntax=docker/dockerfile:1
#
# Sumeru Sarsapa adapter runtime image.
# Single COPY + metadata = base layers + 1 new layer.
FROM sumeru/base:dev
COPY --chown=node:node packages/core/dist /home/node/adapter/core/dist
COPY --chown=node:node packages/core/package.json /home/node/adapter/core/package.json
COPY --chown=node:node packages/adapter-core/dist /home/node/adapter/adapter-core/dist
COPY --chown=node:node packages/adapter-core/package.json /home/node/adapter/adapter-core/package.json
COPY --chown=node:node packages/sarsapa/dist /home/node/adapter/sarsapa/dist
COPY --chown=node:node packages/sarsapa/package.json /home/node/adapter/sarsapa/package.json
RUN cd /home/node/adapter && mkdir -p node_modules/@sumeru \
	&& ln -s /home/node/adapter/core node_modules/@sumeru/core \
	&& ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /home/node/adapter/sarsapa node_modules/@sumeru/sarsapa \
	&& ln -s /home/node/adapter/sarsapa/dist/main.js /home/node/.local/bin/sumeru-adapter \
	&& chmod +x /home/node/adapter/sarsapa/dist/main.js
USER node
WORKDIR /workspace
LABEL sumeru.harness="sarsapa"
CMD ["sleep", "infinity"]
