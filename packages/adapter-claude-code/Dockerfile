# syntax=docker/dockerfile:1
#
# Sumeru Claude Code adapter runtime image.
# Installs Claude Code CLI + adapter dist. Adds 2 layers on top of base.
FROM sumeru/base:dev
RUN npm install -g @anthropic-ai/claude-code \
	&& mkdir -p /home/node/.claude && chown node:node /home/node/.claude
COPY --chown=node:node packages/ /opt/sumeru/
RUN cd /opt/sumeru && mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/sumeru-session node_modules/@sumeru/sumeru-session \
	&& ln -s /opt/sumeru/adapter-claude-code node_modules/@sumeru/adapter-claude-code
USER node
WORKDIR /workspace
CMD ["sleep", "infinity"]
