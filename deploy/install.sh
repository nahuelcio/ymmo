#!/usr/bin/env bash
# Claudi MMO — one-shot install (latest Node, systemd, nginx, auto-update from git) on a fresh Ubuntu/Debian VPS (run as root).
#   curl -fsSL https://raw.githubusercontent.com/nahuelcio/ymmo/main/deploy/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/nahuelcio/ymmo/main/deploy/install.sh | bash -s mijuego.com   # with HTTPS
# Re-running it is safe: it updates the code and keeps the database.
set -euo pipefail

DOMAIN="${1:-}"
REPO="${REPO:-https://github.com/nahuelcio/ymmo.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/claudi-mmo
APP_USER=claudi
PORT=3001
NODE_DIR=/opt/node
export PATH="$NODE_DIR/bin:/usr/local/bin:/usr/bin:/bin"
as_app() { sudo -u "$APP_USER" env PATH="$PATH" HOME="/home/$APP_USER" bash -c "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Correlo como root (sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Paquetes del sistema"
apt-get update -y
apt-get install -y curl git nginx ca-certificates gnupg ufw

# Our own latest Node in /opt/node, readable by every user (ignores any nvm / root-only install).
LATEST=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9.]*"' | head -1 | cut -d'"' -f4)
if ! [ -x "$NODE_DIR/bin/node" ] || [ "$("$NODE_DIR/bin/node" -v)" != "$LATEST" ]; then
  echo "==> Node.js $LATEST (oficial, en $NODE_DIR)"
  rm -rf "$NODE_DIR"
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64|arm64) ARCH=arm64 ;; *) echo "Arquitectura no soportada: $(uname -m)"; exit 1 ;; esac
  TARBALL=$(curl -fsSL https://nodejs.org/dist/latest/SHASUMS256.txt | awk "/linux-$ARCH.tar.xz/ {print \$2}")
  mkdir -p "$NODE_DIR"
  curl -fsSL "https://nodejs.org/dist/latest/$TARBALL" | tar -xJ -C "$NODE_DIR" --strip-components=1
  chmod -R a+rX "$NODE_DIR"
fi
echo "    node $("$NODE_DIR/bin/node" -v)"

echo "==> Usuario y código"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "/home/$APP_USER" && chown "$APP_USER:$APP_USER" "/home/$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
  as_app "cd $APP_DIR && git fetch origin $BRANCH && git reset --hard origin/$BRANCH"
else
  rm -rf "$APP_DIR"
  mkdir -p "$APP_DIR" && chown "$APP_USER:$APP_USER" "$APP_DIR"
  as_app "git clone --branch $BRANCH $REPO $APP_DIR"
fi

echo "==> Dependencias y build del cliente"
as_app "cd $APP_DIR && npm ci --no-audit --no-fund && npm run build"

echo "==> Servicio systemd"
cat > /etc/systemd/system/claudi-mmo.service <<UNIT
[Unit]
Description=Claudi MMO game server
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=GAME_PORT=$PORT
Environment=NODE_ENV=production
Environment=PATH=$NODE_DIR/bin:/usr/bin:/bin
ExecStart=$NODE_DIR/bin/node $APP_DIR/node_modules/tsx/dist/cli.mjs server/src/index.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now claudi-mmo
systemctl restart claudi-mmo

echo "==> nginx (proxy + WebSocket)"
SERVER_NAME="${DOMAIN:-_}"
cat > /etc/nginx/sites-available/claudi-mmo <<NGINX
map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name $SERVER_NAME;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 1h;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/claudi-mmo /etc/nginx/sites-enabled/claudi-mmo
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

if [ -n "$DOMAIN" ]; then
  echo "==> HTTPS con Let's Encrypt para $DOMAIN"
  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || \
    echo "!! No se pudo emitir el certificado: revisá que $DOMAIN apunte a esta IP y volvé a correr el script."
fi

echo "==> Backup diario de la base de datos (guarda 14 días)"
mkdir -p /var/backups/claudi-mmo
cat > /etc/cron.daily/claudi-mmo-backup <<CRON
#!/bin/sh
[ -f $APP_DIR/server/data/game.db ] || exit 0
cp $APP_DIR/server/data/game.db /var/backups/claudi-mmo/game-\$(date +%F).db
find /var/backups/claudi-mmo -name 'game-*.db' -mtime +14 -delete
CRON
chmod +x /etc/cron.daily/claudi-mmo-backup

echo "==> Auto-actualización: cada minuto revisa $BRANCH y, si hay commits nuevos, actualiza solo"
cat > /etc/systemd/system/claudi-mmo-autoupdate.service <<UNIT
[Unit]
Description=Claudi MMO: update from git if $BRANCH moved

[Service]
Type=oneshot
Environment=BRANCH=$BRANCH
ExecStart=/bin/bash $APP_DIR/deploy/autoupdate.sh
UNIT
cat > /etc/systemd/system/claudi-mmo-autoupdate.timer <<UNIT
[Unit]
Description=Check for Claudi MMO updates every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now claudi-mmo-autoupdate.timer

IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
echo
echo "Listo. Abrí: ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$IP}"
echo "Logs: journalctl -u claudi-mmo -f    Auto-updates: journalctl -u claudi-mmo-autoupdate -f"
echo "Se actualiza solo al pushear a $BRANCH (en ~1 min). Forzar: bash $APP_DIR/deploy/update.sh"
