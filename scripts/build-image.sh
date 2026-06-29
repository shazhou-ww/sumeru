#!/bin/bash
set -e
cd "$(dirname "$0")/.."

# Usage: ./scripts/build-image.sh [adapter-name]
# If no argument, builds all images.
# Examples:
#   ./scripts/build-image.sh claude-code
#   ./scripts/build-image.sh codex
#   ./scripts/build-image.sh hermes
#   ./scripts/build-image.sh sarsapa
#   ./scripts/build-image.sh        # builds all

ADAPTERS=("claude-code" "codex" "hermes" "sarsapa")

if [ -n "$1" ]; then
	ADAPTERS=("$1")
fi

pnpm run build

cp docker/.dockerignore .dockerignore
trap 'rm -f .dockerignore' EXIT

for adapter in "${ADAPTERS[@]}"; do
	echo "=== Building sumeru/${adapter}:dev ==="
	docker build -t "sumeru/${adapter}:dev" -f "docker/${adapter}/Dockerfile" .
done
