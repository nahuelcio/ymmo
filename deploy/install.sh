#!/usr/bin/env bash
# Claudi MMO — one-shot install on a fresh Ubuntu/Debian VPS (run as root).
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

[ "$(id -u)" -eq 0 ] || { echo "Correlo como root (sudo)."; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "==> Paquetes del sistema"
apt-get update -y
apt-get install -y curl git nginx ca-certificates gnupg ufw

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Usuario y código"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Dependencias y build del cliente"
sudo -u "$APP_USER" bash -c "cd $APP_DIR && npm ci --no-audit --no-fund && npm run build"

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
ExecStart=$APP_DIR/node_modules/.bin/tsx server/src/index.ts
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

IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
echo
echo "Listo. Abrí: ${DOMAIN:+https://$DOMAIN}${DOMAIN:-http://$IP}"
echo "Logs: journalctl -u claudi-mmo -f    Actualizar: bash $APP_DIR/deploy/update.sh"
