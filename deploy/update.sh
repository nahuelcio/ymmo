#!/usr/bin/env bash
# Pull the latest main, rebuild and restart (keeps the database). Run as root.
set -euo pipefail
APP_DIR=/opt/claudi-mmo
BRANCH="${BRANCH:-main}"
cp "$APP_DIR/server/data/game.db" "/var/backups/claudi-mmo/game-pre-update-$(date +%F-%H%M).db" 2>/dev/null || true
sudo -u claudi bash -c "cd $APP_DIR && git fetch origin $BRANCH && git reset --hard origin/$BRANCH && npm ci --no-audit --no-fund && npm run build"
systemctl restart claudi-mmo
echo "Actualizado a $(git -C $APP_DIR log -1 --format='%h %s')"
