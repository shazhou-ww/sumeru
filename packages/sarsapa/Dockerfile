FROM node:24-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends git curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /home/node/adapter
COPY dist/ ./dist/
COPY package.json ./

USER node
CMD ["sleep", "infinity"]
