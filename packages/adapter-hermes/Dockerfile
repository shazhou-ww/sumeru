FROM node:24-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git curl ca-certificates build-essential ripgrep sudo coreutils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/node/adapter

# Copy core dependencies
COPY packages/core/dist ./core/dist
COPY packages/core/package.json ./core/package.json
COPY packages/adapter-core/dist ./adapter-core/dist
COPY packages/adapter-core/package.json ./adapter-core/package.json

# Copy adapter
COPY packages/adapter-hermes/dist ./hermes/dist
COPY packages/adapter-hermes/package.json ./hermes/package.json

# Create symlinks for module resolution
RUN mkdir -p node_modules/@sumeru /home/node/.local/bin && \
    ln -s /home/node/adapter/core node_modules/@sumeru/core && \
    ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core && \
    ln -s /home/node/adapter/hermes node_modules/@sumeru/adapter-hermes && \
    ln -s /home/node/adapter/hermes/dist/main.js /home/node/.local/bin/sumeru-adapter && \
    chmod +x /home/node/adapter/hermes/dist/main.js

ENV PATH="/home/node/.local/bin:${PATH}"
USER node
WORKDIR /workspace
ENTRYPOINT []
CMD ["tail", "-f", "/dev/null"]
