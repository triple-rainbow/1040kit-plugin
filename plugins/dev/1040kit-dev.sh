#!/bin/sh
# Run the 1040kit MCP server from this repo (TypeScript, no build) for local testing.
# Taxes go to a sandbox in the repo unless KIT1040_HOME / KIT1040_CONFIG_DIR are set.
set -e
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
: "${KIT1040_HOME:=$REPO/.dev/taxes}"
: "${KIT1040_CONFIG_DIR:=$REPO/.dev/config}"
export KIT1040_HOME KIT1040_CONFIG_DIR
exec node --import "$REPO/packages/mcp/node_modules/tsx/dist/esm/index.mjs" "$REPO/packages/mcp/src/bin.ts" "$@"
