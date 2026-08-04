#!/bin/sh
# init-dind.sh — Start DinD dockerd and load adapter images.
#
# Reuses existing dockerd if already running (from a previous step in the same container).
# Otherwise kills any stale state, starts fresh dockerd with fuse-overlayfs, and loads images.

# Reuse existing dockerd if running
if docker info >/dev/null 2>&1; then
  if docker image inspect sumeru/sarsapa:dev >/dev/null 2>&1; then
    return 0 2>/dev/null || true
  fi
  # dockerd running but images missing — load them
  PREBUILT="/app/spec/images-prebuilt.tar.gz"
  if [ -f "$PREBUILT" ]; then
    docker load -qi "$PREBUILT" 2>/dev/null && return 0 2>/dev/null || true
  fi
fi

# Kill any inherited dockerd/containerd (from parent's committed state)
pkill -9 dockerd 2>/dev/null || true
pkill -9 containerd 2>/dev/null || true
sleep 1

# Clean DinD state completely — this is critical!
# Remove /var/lib/docker to eliminate fuse-overlayfs mount point directories
# that would cause the outer docker commit to fail with "no such file or directory"
rm -rf /var/run/docker /var/run/docker.pid /var/run/docker.sock
rm -rf /var/lib/docker /var/lib/containerd

# Start fresh dockerd with fuse-overlayfs (what treespec uses)
dockerd --storage-driver=fuse-overlayfs >/tmp/dockerd.log 2>&1 &
for i in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done

# Load prebuilt images
PREBUILT_GZ="/opt/sumeru/images.tar.gz"
if [ -f "$PREBUILT_GZ" ]; then
  docker load -qi "$PREBUILT_GZ" 2>/dev/null
fi

# Fallback: build from source if images not available
if ! docker image inspect sumeru/sarsapa:dev >/dev/null 2>&1; then
  cd /app
  if ! docker image inspect sumeru/base:dev >/dev/null 2>&1; then
    docker build -q -t sumeru/base:dev -f packages/base/Dockerfile packages/base/
  fi
  docker build -q -t sumeru/sarsapa:dev -f packages/sarsapa/Dockerfile .
fi
