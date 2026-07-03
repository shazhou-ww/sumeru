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
COPY --chown=node:node packages/ /opt/sumeru/
RUN cd /opt/sumeru && mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/sumeru-session node_modules/@sumeru/sumeru-session \
	&& ln -s /opt/sumeru/adapter-cursor-agent node_modules/@sumeru/adapter-cursor-agent
USER node
WORKDIR /workspace
LABEL sumeru.harness="cursor-agent"
CMD ["sleep", "infinity"]
