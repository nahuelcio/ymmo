#!/usr/bin/env bash
# Client hot reload against the running Docker game server.
# Edit client/src and the browser updates. No image rebuild.
# The Rust server still needs a rebuild when server-rs changes.
# Usage: ./scripts/hot.sh
# Open http://127.0.0.1:5173
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "$(docker inspect -f '{{.State.Running}}' claudi-mmo-50 2>/dev/null || true)" != "true" ]]; then
  docker start claudi-mmo-50 >/dev/null
fi

export GAME_PORT=3002
exec npm run dev
