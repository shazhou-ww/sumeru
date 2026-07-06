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
COPY --chown=node:node packages/ /opt/sumeru/
RUN cd /opt/sumeru && mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/adapter-hermes node_modules/@sumeru/adapter-hermes
USER node
WORKDIR /opt/sumeru
LABEL sumeru.harness="hermes"
CMD ["sleep", "infinity"]
