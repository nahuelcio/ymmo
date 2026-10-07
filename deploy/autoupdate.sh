#!/usr/bin/env bash
# Run by the claudi-mmo-autoupdate timer every minute: update only when the branch moved.
set -euo pipefail
APP_DIR=/opt/claudi-mmo
BRANCH="${BRANCH:-main}"
as_app() { sudo -u claudi env PATH="/opt/node/bin:/usr/bin:/bin" HOME=/home/claudi bash -c "$1"; }
as_app "git -C $APP_DIR fetch -q origin $BRANCH"
LOCAL=$(as_app "git -C $APP_DIR rev-parse HEAD")
REMOTE=$(as_app "git -C $APP_DIR rev-parse origin/$BRANCH")
[ "$LOCAL" = "$REMOTE" ] && exit 0
echo "Nuevo commit en $BRANCH: ${LOCAL:0:7} -> ${REMOTE:0:7}"
exec /bin/bash "$APP_DIR/deploy/update.sh"
