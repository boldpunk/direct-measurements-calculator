#!/usr/bin/env bash
# One-time provisioning for a fresh Ubuntu 22.04/24.04 server (e.g. Hetzner CX22).
# Run as root: sudo bash provision.sh
#
# Idempotent — safe to re-run; it won't overwrite an existing
# /etc/mebelflow/server.env or drop the database if they already exist.
set -euo pipefail

APP_USER="mebelflow"
APP_DIR="/opt/mebelflow"
DB_NAME="mebelflow"
DB_USER="mebelflow"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo bash provision.sh)" >&2
  exit 1
fi

echo "==> Updating system packages"
apt-get update -y
apt-get upgrade -y

echo "==> Installing base tools"
apt-get install -y curl git ufw

echo "==> Installing Node.js 20 LTS"
if ! command -v node >/dev/null || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing PostgreSQL"
apt-get install -y postgresql postgresql-contrib

echo "==> Installing Nginx"
apt-get install -y nginx

echo "==> Installing certbot"
apt-get install -y certbot python3-certbot-nginx

echo "==> Creating app system user"
if ! id "$APP_USER" &>/dev/null; then
  useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"

echo "==> Creating PostgreSQL role + database"
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -base64 24)}"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"
fi

echo "==> Writing /etc/mebelflow/server.env"
mkdir -p /etc/mebelflow
if [[ ! -f /etc/mebelflow/server.env ]]; then
  JWT_SECRET="$(openssl rand -base64 48)"
  cat > /etc/mebelflow/server.env <<EOF
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}
JWT_SECRET=${JWT_SECRET}
PORT=4000
CORS_ORIGIN=https://mebelflow.uz,https://www.mebelflow.uz
EOF
  chown root:"$APP_USER" /etc/mebelflow/server.env
  chmod 640 /etc/mebelflow/server.env
  echo "    Generated a new DB password + JWT secret in /etc/mebelflow/server.env"
else
  echo "    Already exists — leaving it untouched"
fi

echo "==> Installing systemd service"
cp "$SCRIPT_DIR/mebelflow-api.service" /etc/systemd/system/mebelflow-api.service
systemctl daemon-reload
systemctl enable mebelflow-api

echo "==> Installing Nginx site"
cp "$SCRIPT_DIR/nginx/mebelflow.conf" /etc/nginx/sites-available/mebelflow.conf
ln -sf /etc/nginx/sites-available/mebelflow.conf /etc/nginx/sites-enabled/mebelflow.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Configuring firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

cat <<'MSG'

==> Provisioning done.

Next steps:
  1. Point mebelflow.uz and www.mebelflow.uz A records at this server's IP.
  2. Run deploy.sh to clone the repo into /opt/mebelflow, build, and start the API
     (it needs to run as a user that can sudo — see deploy/README.md).
  3. Once DNS resolves, run:
       certbot --nginx -d mebelflow.uz -d www.mebelflow.uz
     for free HTTPS — it edits the Nginx config to add the redirect automatically.
MSG
