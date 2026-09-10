#!/usr/bin/env bash
# Provisions an ADDITIONAL MebelFlow instance on a server that already ran
# provision.sh once (Node/Postgres/Nginx/certbot/ufw already installed).
# Gives a second company its own app directory, database, systemd service
# and Nginx site — fully isolated from the first instance's data.
#
# Run as root: sudo bash provision-second-instance.sh
#
# Required env vars:
#   INSTANCE  short slug, e.g. "sobirov" (used in paths/service names)
#   DOMAIN    e.g. "sobirov.mebelflow.uz"
#   PORT      backend port, must not collide with another instance (main uses 4000)
set -euo pipefail

: "${INSTANCE:?Set INSTANCE (e.g. sobirov)}"
: "${DOMAIN:?Set DOMAIN (e.g. sobirov.mebelflow.uz)}"
: "${PORT:?Set PORT (e.g. 4001)}"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash provision-second-instance.sh)" >&2
  exit 1
fi

APP_USER="mebelflow"
APP_DIR="/opt/mebelflow-${INSTANCE}"
DB_NAME="mebelflow_${INSTANCE}"
DB_USER="mebelflow_${INSTANCE}"
SERVICE_NAME="mebelflow-api-${INSTANCE}"
ENV_FILE="/etc/mebelflow/server-${INSTANCE}.env"

echo "==> App directory"
mkdir -p "$APP_DIR"

echo "==> PostgreSQL role + database"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 24)}"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

echo "==> Writing ${ENV_FILE}"
mkdir -p /etc/mebelflow
if [[ ! -f "$ENV_FILE" ]]; then
  JWT_SECRET="$(openssl rand -base64 48)"
  cat > "$ENV_FILE" <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
PORT=${PORT}
CORS_ORIGIN=https://${DOMAIN}
EOF
  chown root:"$APP_USER" "$ENV_FILE"
  chmod 640 "$ENV_FILE"
  echo "    Generated a new DB password + JWT secret in ${ENV_FILE}"
else
  echo "    Already exists — leaving it untouched"
fi

echo "==> Installing systemd service ${SERVICE_NAME}"
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=MebelFlow API (${INSTANCE})
After=network.target postgresql.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_DIR}/server
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "==> Installing Nginx site for ${DOMAIN}"
cat > "/etc/nginx/sites-available/${INSTANCE}.conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    root ${APP_DIR}/dist;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location /api/ {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:${PORT}/health;
        proxy_set_header Host \$host;
    }

    location ~* \.(?:js|css|woff2?|ttf|svg|png|jpg|jpeg|gif|ico)\$ {
        try_files \$uri =404;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    location / {
        add_header Cache-Control "no-cache" always;
        try_files \$uri /index.html;
    }
}
EOF
ln -sf "/etc/nginx/sites-available/${INSTANCE}.conf" "/etc/nginx/sites-enabled/${INSTANCE}.conf"
nginx -t && systemctl reload nginx

cat <<MSG

==> Provisioning done for '${INSTANCE}'.

Next steps:
  1. Point ${DOMAIN} at this server's IP (A record with your DNS provider).
  2. Build + start it (env vars tell deploy.sh which instance to target):
       APP_DIR=${APP_DIR} ENV_FILE=${ENV_FILE} SERVICE_NAME=${SERVICE_NAME} \\
         sudo -E bash ${APP_DIR}/deploy/deploy.sh
     (first run will git-clone into ${APP_DIR} automatically)
  3. Once DNS resolves, get HTTPS:
       certbot --nginx -d ${DOMAIN}
  4. Seed just an admin login (no demo data):
       cd ${APP_DIR}/server
       set -a; source ${ENV_FILE}; set +a
       COMPANY_NAME="Sobirov Mebel" ADMIN_NAME="..." \\
         ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run seed:fresh
MSG
