# syntax=docker/dockerfile:1
#
# Sumeru Codex adapter runtime image.
# Installs Codex CLI + adapter dist. Adds 2 layers on top of base.
FROM sumeru/base:dev
RUN npm install -g @openai/codex \
	&& mkdir -p /home/node/.codex && chown node:node /home/node/.codex
COPY --chown=node:node packages/ /opt/sumeru/
RUN cd /opt/sumeru && mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-codex node_modules/@sumeru/adapter-codex
USER node
WORKDIR /workspace
LABEL sumeru.harness="codex"
CMD ["sleep", "infinity"]
