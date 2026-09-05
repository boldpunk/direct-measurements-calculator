#!/usr/bin/env bash
# Deploy or update MebelFlow on the server. Safe to re-run for every release —
# does a fresh clone the first time, `git reset --hard` to the target branch
# after that. Needs sudo (to restart the systemd service and reload Nginx).
set -euo pipefail

APP_DIR="/opt/mebelflow"
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
source /etc/mebelflow/server.env
set +a
npx prisma migrate deploy

echo "==> Restarting API"
sudo systemctl restart mebelflow-api
sudo systemctl reload nginx

echo "==> Done. API status:"
sudo systemctl --no-pager --lines=5 status mebelflow-api
