#!/usr/bin/env bash
# Deploy or update MebelFlow on the server. Safe to re-run for every release —
# does a fresh clone the first time, `git reset --hard` to the target branch
# after that. Needs sudo (to restart the systemd service and reload Nginx).
#
# For a second company instance on the same server (see
# provision-second-instance.sh), pass its app dir / env file / service name
# either as env vars or as three positional args (the latter needs no
# underscored identifiers typed, handy when pasting into a flaky console):
#   sudo bash deploy/deploy.sh /opt/mebelflow-sobirov /etc/mebelflow/server-sobirov.env mebelflow-api-sobirov
set -euo pipefail

APP_DIR="${1:-${APP_DIR:-/opt/mebelflow}}"
ENV_FILE="${2:-${ENV_FILE:-/etc/mebelflow/server.env}}"
SERVICE_NAME="${3:-${SERVICE_NAME:-mebelflow-api}}"
REPO_URL="${REPO_URL:-https://github.com/boldpunk/direct-measurements-calculator.git}"
BRANCH="${BRANCH:-main}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "==> First-time clone ($BRANCH)"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
echo "==> Pulling latest ($BRANCH)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Installing + building frontend (same-origin API, relative /api paths)"
npm ci
VITE_API_URL= npm run build

echo "==> Installing backend deps + migrating database"
cd "$APP_DIR/server"
npm ci
npx prisma generate
set -a
source "$ENV_FILE"
set +a
npx prisma migrate deploy

echo "==> Server-wide setup (idempotent): nightly backups of every DB + nginx upload limit"
# Every instance runs the same deploy, so these are simply rewritten each time.
sudo tee /etc/cron.d/mebelflow-backup >/dev/null <<'CRON'
0 3 * * * root /opt/mebelflow/deploy/backup-db.sh >> /var/log/mebelflow-backup.log 2>&1
CRON
sudo install -m 644 "$APP_DIR/deploy/nginx/upload-limit.conf" /etc/nginx/conf.d/mebelflow-upload-limit.conf
sudo nginx -t

echo "==> Restarting API"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload nginx

echo "==> Done. API status:"
sudo systemctl --no-pager --lines=5 status "$SERVICE_NAME"
