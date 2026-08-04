FROM node:22-alpine

# System deps: Docker for DinD
RUN apk add --no-cache docker fuse-overlayfs fuse \
    && corepack enable pnpm

# Build project at /opt/sumeru (NOT /app — treespec mount-overlays /app at runtime)
COPY . /opt/sumeru
WORKDIR /opt/sumeru

# Replace workspace link with npm version (link target doesn't exist in container)
RUN sed -i 's|link:../ocas/packages/cli-kit|0.5.0|g' pnpm-workspace.yaml package.json 2>/dev/null; \
    sed -i 's|link:../../../ocas/packages/cli-kit|0.5.0|g' packages/cli/package.json 2>/dev/null; \
    true

# Install deps (no native module compilation needed — uses node:sqlite)
RUN pnpm install --no-frozen-lockfile

# Build TypeScript → dist/ (treespec skips dist/ in build context)
RUN pnpm run build

# Recreate bin symlinks (pnpm install ran before dist/ existed)
RUN ln -sf /opt/sumeru/packages/cli/dist/main.js /opt/sumeru/node_modules/.bin/sumeru

# /app is mount-overlaid by treespec (specs live there)
# sumeru binary comes from /opt/sumeru/node_modules/.bin
ENV PATH="/opt/sumeru/node_modules/.bin:$PATH"
