# syntax=docker/dockerfile:1
#
# Sumeru Cursor Agent adapter runtime image.
# Installs cursor-agent via official installer + adapter dist. Adds 2 layers on top of base.
FROM sumeru/base:dev
ENV PATH="/home/node/.local/bin:${PATH}"
RUN mkdir -p /home/node/.local/bin /home/node/.local/share \
	&& curl -fsSL https://cursor.com/install | sh \
	&& chown -R node:node /home/node/.local \
	&& cursor-agent --version \
	&& mkdir -p /home/node/.cursor && chown node:node /home/node/.cursor
COPY --chown=node:node packages/core/dist /home/node/adapter/core/dist
COPY --chown=node:node packages/core/package.json /home/node/adapter/core/package.json
COPY --chown=node:node packages/adapter-core/dist /home/node/adapter/adapter-core/dist
COPY --chown=node:node packages/adapter-core/package.json /home/node/adapter/adapter-core/package.json
COPY --chown=node:node packages/adapter-cursor-agent/dist /home/node/adapter/adapter-cursor-agent/dist
COPY --chown=node:node packages/adapter-cursor-agent/package.json /home/node/adapter/adapter-cursor-agent/package.json
RUN cd /home/node/adapter && mkdir -p node_modules/@sumeru \
	&& ln -s /home/node/adapter/core node_modules/@sumeru/core \
	&& ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /home/node/adapter/adapter-cursor-agent node_modules/@sumeru/adapter-cursor-agent \
	&& ln -s /home/node/adapter/adapter-cursor-agent/dist/main.js /home/node/.local/bin/sumeru-adapter \
	&& chmod +x /home/node/adapter/adapter-cursor-agent/dist/main.js
USER node
WORKDIR /workspace
LABEL sumeru.harness="cursor-agent"
CMD ["sleep", "infinity"]
