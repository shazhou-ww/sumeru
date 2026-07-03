# syntax=docker/dockerfile:1
#
# Sumeru Cursor Agent adapter runtime image.
# Unlike other adapters (npm install -g), cursor-agent is a self-contained
# package installed via the official https://cursor.com/install script.
FROM sumeru/base:dev

# Install cursor-agent CLI — self-contained package (not npm).
ENV PATH="/home/node/.local/bin:${PATH}"
RUN mkdir -p /home/node/.local/bin /home/node/.local/share \
	&& curl -fsSL https://cursor.com/install | sh \
	&& chown -R node:node /home/node/.local \
	&& cursor-agent --version

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-cursor-agent/package.json ./adapter-cursor-agent/
COPY packages/adapter-cursor-agent/dist ./adapter-cursor-agent/dist/

RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-cursor-agent node_modules/@sumeru/adapter-cursor-agent

RUN chown -R node:node /opt/sumeru \
	&& mkdir -p /home/node/.cursor && chown node:node /home/node/.cursor

USER node
WORKDIR /workspace

CMD ["sleep", "infinity"]
