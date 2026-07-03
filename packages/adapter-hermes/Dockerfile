# syntax=docker/dockerfile:1
#
# Sumeru Hermes adapter runtime image.
FROM sumeru/base:dev

# Hermes is a Python package — install into a shared venv accessible by non-root user.
ENV HERMES_VENV=/opt/hermes-venv
RUN uv venv "$HERMES_VENV" --python 3.12 \
	&& uv pip install --python "$HERMES_VENV/bin/python" "hermes-agent[acp]" \
	&& ln -sf "$HERMES_VENV/bin/hermes" /usr/local/bin/hermes

WORKDIR /opt/sumeru

COPY packages/core/package.json ./core/
COPY packages/core/dist ./core/dist/
COPY packages/adapter-core/package.json ./adapter-core/
COPY packages/adapter-core/dist ./adapter-core/dist/
COPY packages/adapter-hermes/package.json ./adapter-hermes/
COPY packages/adapter-hermes/dist ./adapter-hermes/dist/

RUN mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-hermes node_modules/@sumeru/adapter-hermes

RUN chown -R node:node /opt/sumeru /opt/hermes-venv \
	&& mkdir -p /home/node/.hermes && chown node:node /home/node/.hermes

USER node
WORKDIR /opt/sumeru

CMD ["sleep", "infinity"]
