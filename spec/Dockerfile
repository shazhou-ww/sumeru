FROM node:22-alpine

# Install docker-cli (treespec mounts /var/run/docker.sock automatically)
RUN apk add --no-cache docker-cli

# @ocas/cli-kit is a link: dep (workspace override) pointing outside the repo.
# The symlink resolves to /ocas/packages/cli-kit inside the container.
# Install from npm and place it where the symlink expects it.
RUN npm install -g @ocas/cli-kit@0.5.0 \
    && mkdir -p /ocas/packages/cli-kit \
    && cp -r $(npm root -g)/@ocas/cli-kit/* /ocas/packages/cli-kit/

WORKDIR /app
ENV PATH="/app/node_modules/.bin:$PATH"
