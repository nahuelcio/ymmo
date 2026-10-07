#!/usr/bin/env bash
# Pull the latest branch, rebuild and restart (keeps the database). Run as root.
# If install or build fails, it rolls the code back and leaves the running server alone.
set -euo pipefail
APP_DIR=/opt/claudi-mmo
BRANCH="${BRANCH:-main}"
export PATH="/opt/node/bin:/usr/bin:/bin"
as_app() { sudo -u claudi env PATH="$PATH" HOME=/home/claudi bash -c "$1"; }

OLD=$(as_app "git -C $APP_DIR rev-parse HEAD")
mkdir -p /var/backups/claudi-mmo
cp "$APP_DIR/server/data/game.db" "/var/backups/claudi-mmo/game-pre-update-$(date +%F-%H%M).db" 2>/dev/null || true
find /var/backups/claudi-mmo -name 'game-pre-update-*.db' -mtime +7 -delete 2>/dev/null || true

if ! as_app "cd $APP_DIR && git fetch -q origin $BRANCH && git reset -q --hard origin/$BRANCH && npm ci --no-audit --no-fund --loglevel=error && npm run build"; then
  echo "!! La actualización falló: vuelvo a $OLD y no reinicio."
  as_app "cd $APP_DIR && git reset -q --hard $OLD && npm ci --no-audit --no-fund --loglevel=error && npm run build" || true
  exit 1
fi
systemctl restart claudi-mmo
echo "Actualizado: $(as_app "git -C $APP_DIR log -1 --format='%h %s'")"
