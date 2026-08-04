FROM node:22-alpine

# Install Docker Engine (dockerd + cli + fuse-overlayfs) for treespec DinD mode.
# treespec 0.4+ runs containers with Privileged:true and starts dockerd inside
# using fuse-overlayfs storage driver. The CLI alone is insufficient.
RUN apk add --no-cache docker fuse-overlayfs fuse

# @ocas/cli-kit is a link: dep (workspace override) pointing outside the repo.
# The symlink resolves to /ocas/packages/cli-kit inside the container.
# Install from npm and place it where the symlink expects it.
RUN npm install -g @ocas/cli-kit@0.5.0 \
    && mkdir -p /ocas/packages/cli-kit \
    && cp -r $(npm root -g)/@ocas/cli-kit/* /ocas/packages/cli-kit/

WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"
