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
COPY packages/adapter-cursor-agent/dist ./cursor-agent/dist
COPY packages/adapter-cursor-agent/package.json ./cursor-agent/package.json

# Create symlinks for module resolution
RUN mkdir -p node_modules/@sumeru /home/node/.local/bin && \
    ln -s /home/node/adapter/core node_modules/@sumeru/core && \
    ln -s /home/node/adapter/adapter-core node_modules/@sumeru/adapter-core && \
    ln -s /home/node/adapter/cursor-agent node_modules/@sumeru/adapter-cursor-agent && \
    ln -s /home/node/adapter/cursor-agent/dist/main.js /home/node/.local/bin/sumeru-adapter && \
    chmod +x /home/node/adapter/cursor-agent/dist/main.js

ENV PATH="/home/node/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
USER node
WORKDIR /workspace
ENTRYPOINT []
CMD ["/usr/bin/tail", "-f", "/dev/null"]
