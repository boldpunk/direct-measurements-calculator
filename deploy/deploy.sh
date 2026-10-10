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
# Build next to the live site and swap only on success: Vite empties its
# output dir first, so a failed build straight into dist/ took the site down.
rm -rf dist-next
VITE_API_URL= npx vite build --outDir dist-next
rm -rf dist-prev
[[ -d dist ]] && mv dist dist-prev
mv dist-next dist

echo "==> Installing backend deps + migrating database"
cd "$APP_DIR/server"
npm ci
npx prisma generate
set -a
source "$ENV_FILE"
set +a

# Safety copy right before the schema changes, so a bad migration can be
# rolled back to the exact pre-deploy data (restore: see README §7).
DB_NAME="${DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
BACKUP_DIR="${BACKUP_DIR:-/opt/mebelflow/backups}"
sudo mkdir -p "$BACKUP_DIR"
PRE_DUMP="$BACKUP_DIR/${DB_NAME}-$(date +%Y%m%d-%H%M%S).sql.gz"
echo "==> Pre-deploy backup of $DB_NAME → $PRE_DUMP"
sudo -u postgres pg_dump "$DB_NAME" | gzip | sudo tee "$PRE_DUMP" >/dev/null
[[ -s "$PRE_DUMP" ]] || { echo "!!! Pre-deploy backup failed — not migrating"; exit 1; }

npx prisma migrate deploy

echo "==> Server-wide setup (idempotent): nightly backups, health monitor, nginx upload limit"
# Every instance runs the same deploy, so these are simply rewritten each time.
sudo tee /etc/cron.d/mebelflow-backup >/dev/null <<'CRON'
0 3 * * * root /opt/mebelflow/deploy/backup-db.sh >> /var/log/mebelflow-backup.log 2>&1
CRON
sudo tee /etc/cron.d/mebelflow-healthcheck >/dev/null <<'CRON'
*/5 * * * * root /opt/mebelflow/deploy/healthcheck.sh >> /var/log/mebelflow-health.log 2>&1
CRON
sudo install -m 644 "$APP_DIR/deploy/nginx/upload-limit.conf" /etc/nginx/conf.d/mebelflow-upload-limit.conf
sudo nginx -t

echo "==> Restarting API"
sudo systemctl restart "$SERVICE_NAME"
sudo systemctl reload nginx

# Don't report success for an API that crashed on start (bad migration,
# missing env var): wait for /health, which also checks the database.
API_PORT="${PORT:-4000}"
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
if [[ $healthy -ne 1 ]]; then
  echo "!!! API on port ${API_PORT} is not healthy after restart. Last log lines:"
  sudo journalctl -u "$SERVICE_NAME" --no-pager -n 30 || true
  echo "!!! Data before this deploy: $PRE_DUMP"
  exit 1
fi
echo "==> API healthy on port ${API_PORT}"

echo "==> Done. API status:"
sudo systemctl --no-pager --lines=5 status "$SERVICE_NAME"
