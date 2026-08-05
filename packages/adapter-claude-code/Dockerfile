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
COPY packages/adapter-claude-code/dist ./claude-code/dist
COPY packages/adapter-claude-code/package.json ./claude-code/package.json

# Create symlinks for module resolution
RUN mkdir -p node_modules/@sumeru /home/node/.local/bin && \
    ln -s /home/node/adapter/core node_modules/@sumeru/core && \
    ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core && \
    ln -s /home/node/adapter/claude-code node_modules/@sumeru/adapter-claude-code && \
    ln -s /home/node/adapter/claude-code/dist/main.js /home/node/.local/bin/sumeru-adapter && \
    chmod +x /home/node/adapter/claude-code/dist/main.js

ENV PATH="/home/node/.local/bin:${PATH}"
USER node
WORKDIR /workspace
ENTRYPOINT []
CMD ["sleep", "infinity"]
