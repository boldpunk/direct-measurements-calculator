#!/usr/bin/env bash
# Deploy or update MebelFlow on the server. Safe to re-run for every release —
# does a fresh clone the first time, `git reset --hard` to the target branch
# after that. Needs sudo (to restart the systemd service and reload Nginx).
#
# For a second company instance on the same server (see
# provision-second-instance.sh), override APP_DIR/ENV_FILE/SERVICE_NAME, e.g.:
#   APP_DIR=/opt/mebelflow-sobirov ENV_FILE=/etc/mebelflow/server-sobirov.env \
#     SERVICE_NAME=mebelflow-api-sobirov sudo -E bash deploy/deploy.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/mebelflow}"
ENV_FILE="${ENV_FILE:-/etc/mebelflow/server.env}"
SERVICE_NAME="${SERVICE_NAME:-mebelflow-api}"
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

echo "==> Restarting API"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload nginx

echo "==> Done. API status:"
sudo systemctl --no-pager --lines=5 status "$SERVICE_NAME"
