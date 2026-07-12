# syntax=docker/dockerfile:1
#
# Sumeru Hermes adapter runtime image.
# Installs Hermes agent (Python) + adapter dist. Adds 2 layers on top of base.
FROM sumeru/base:dev
ENV HERMES_VENV=/opt/hermes-venv
RUN uv venv "$HERMES_VENV" --python 3.12 \
	&& uv pip install --python "$HERMES_VENV/bin/python" "hermes-agent[acp]" \
	&& ln -sf "$HERMES_VENV/bin/hermes" /usr/local/bin/hermes \
	&& chown -R node:node /opt/hermes-venv \
	&& mkdir -p /home/node/.hermes && chown node:node /home/node/.hermes
COPY --chown=node:node packages/core/dist /home/node/adapter/core/dist
COPY --chown=node:node packages/core/package.json /home/node/adapter/core/package.json
COPY --chown=node:node packages/adapter-core/dist /home/node/adapter/adapter-core/dist
COPY --chown=node:node packages/adapter-core/package.json /home/node/adapter/adapter-core/package.json
COPY --chown=node:node packages/adapter-hermes/dist /home/node/adapter/adapter-hermes/dist
COPY --chown=node:node packages/adapter-hermes/package.json /home/node/adapter/adapter-hermes/package.json
RUN cd /home/node/adapter && mkdir -p node_modules/@sumeru \
	&& ln -s /home/node/adapter/core node_modules/@sumeru/core \
	&& ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /home/node/adapter/adapter-hermes node_modules/@sumeru/adapter-hermes \
	&& ln -s /home/node/adapter/adapter-hermes/dist/main.js /home/node/.local/bin/sumeru-adapter \
	&& chmod +x /home/node/adapter/adapter-hermes/dist/main.js
USER node
WORKDIR /workspace
LABEL sumeru.harness="hermes"
CMD ["sleep", "infinity"]
