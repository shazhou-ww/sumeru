#!/bin/sh
# init-dind.sh — Start DinD dockerd and load adapter images.
# Source this in any spec step that needs `docker` (e.g., sumeru session add).
# Idempotent: skips if dockerd is already running.

if ! docker info >/dev/null 2>&1; then
  rm -rf /var/run/docker /var/run/docker.pid /var/run/docker.sock
  dockerd --storage-driver=fuse-overlayfs >/tmp/dockerd.log 2>&1 &
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

# Load images if sarsapa isn't present
if ! docker image inspect sumeru/sarsapa:dev >/dev/null 2>&1; then
  for f in /app/spec/images-*.tar.gz; do
    [ -f "$f" ] && docker load -qi "$f" 2>/dev/null || true
  done
fi
