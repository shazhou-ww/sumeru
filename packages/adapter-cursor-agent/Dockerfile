FROM node:24-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      git curl ca-certificates build-essential ripgrep sudo coreutils && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/node/adapter
COPY dist/ ./dist/
COPY package.json ./

USER node
ENTRYPOINT []
CMD ["sleep", "infinity"]
