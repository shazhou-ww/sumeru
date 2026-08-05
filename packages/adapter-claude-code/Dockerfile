FROM node:24-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git curl ca-certificates build-essential ripgrep sudo coreutils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/node/adapter
COPY dist/ ./dist/
COPY package.json ./

RUN mkdir -p /home/node/.local/bin && \
    cd /home/node/adapter && \
    ln -s /home/node/adapter/dist/main.js /home/node/.local/bin/sumeru-adapter && \
    chmod +x /home/node/adapter/dist/main.js
ENV PATH="/home/node/.local/bin:${PATH}"
USER node
WORKDIR /workspace
ENTRYPOINT []
CMD ["sleep", "infinity"]
