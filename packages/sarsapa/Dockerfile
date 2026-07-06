# syntax=docker/dockerfile:1
#
# Sumeru Sarsapa adapter runtime image.
# Single COPY + metadata = base layers + 1 new layer.
FROM sumeru/base:dev
COPY --chown=node:node packages/ /opt/sumeru/
RUN cd /opt/sumeru && mkdir -p node_modules/@sumeru \
	&& ln -s /opt/sumeru/core node_modules/@sumeru/core \
	&& ln -s /opt/sumeru/adapter-core node_modules/@sumeru/adapter-core \
	&& ln -s /opt/sumeru/sarsapa node_modules/@sumeru/sarsapa
USER node
WORKDIR /workspace
LABEL sumeru.harness="sarsapa"
CMD ["sleep", "infinity"]
