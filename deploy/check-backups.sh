#!/usr/bin/env bash
# Proves the latest backup of each database actually restores: loads it into
# a throw-away database, counts orders/clients, then drops it. Production
# databases are never touched.
#   sudo /opt/mebelflow/deploy/check-backups.sh
set -uo pipefail
BACKUP_DIR="${BACKUP_DIR:-/opt/mebelflow/backups}"
SCRATCH="mf_restore_check"

latest_per_db=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | awk -F/ '{f=$NF; sub(/-[0-9]{8}-[0-9]{6}\.sql\.gz$/, "", f); if (!seen[f]++) print $0}')
if [[ -z "$latest_per_db" ]]; then
  echo "!!! No backups in $BACKUP_DIR"
  exit 1
fi

failed=0
for dump in $latest_per_db; do
  name=$(basename "$dump")
  sudo -u postgres dropdb --if-exists "$SCRATCH" >/dev/null 2>&1
  sudo -u postgres createdb "$SCRATCH"
  if gunzip -c "$dump" | sudo -u postgres psql -q -v ON_ERROR_STOP=1 "$SCRATCH" >/dev/null 2>&1; then
    counts=$(sudo -u postgres psql -At "$SCRATCH" -c 'SELECT (SELECT count(*) FROM "Order") || '"'"' заказов, '"'"' || (SELECT count(*) FROM "Client") || '"'"' клиентов'"'"'')
    echo "OK   $name — $counts"
  else
    echo "FAIL $name — не восстанавливается"
    failed=1
  fi
done
sudo -u postgres dropdb --if-exists "$SCRATCH" >/dev/null 2>&1
exit $failed
