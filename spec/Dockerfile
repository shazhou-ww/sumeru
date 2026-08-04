FROM node:22-alpine

# Install Docker Engine (dockerd + cli + fuse-overlayfs) for treespec DinD mode.
# treespec 0.4+ runs containers with Privileged:true and starts dockerd inside
# using fuse-overlayfs storage driver. The CLI alone is insufficient.
RUN apk add --no-cache docker fuse-overlayfs fuse

WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"
