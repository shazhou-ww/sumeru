#!/bin/bash
set -e
cd "$(dirname "$0")/.."
pnpm run build
cp docker/.dockerignore .dockerignore
docker build -t sumeru/claude-code:dev -f docker/claude-code/Dockerfile .
rm -f .dockerignore
