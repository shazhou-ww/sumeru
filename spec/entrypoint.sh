#!/bin/sh
# Add global node_modules to NODE_PATH so Node.js can find @ocas/cli-kit
export NODE_PATH=/usr/local/lib/node_modules:$NODE_PATH

# Execute the passed command
exec "$@"
