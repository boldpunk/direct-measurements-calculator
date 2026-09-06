#!/usr/bin/env bash
# Nightly pg_dump backup with rotation. Install via cron as root — see
# deploy/README.md. Runs as the postgres superuser (local peer auth), so it
# never needs the app's DB password.
set -euo pipefail

BACKUP_DIR="/opt/mebelflow/backups"
DB_NAME="mebelflow"
KEEP_DAYS=14
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
sudo -u postgres pg_dump "$DB_NAME" | gzip > "$BACKUP_DIR/mebelflow-${TIMESTAMP}.sql.gz"
find "$BACKUP_DIR" -name 'mebelflow-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

echo "Backup written to $BACKUP_DIR/mebelflow-${TIMESTAMP}.sql.gz"
