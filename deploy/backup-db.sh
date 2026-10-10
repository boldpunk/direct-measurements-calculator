#!/usr/bin/env bash
# Nightly pg_dump of EVERY MebelFlow database on this server, with rotation
# and an optional copy off the server.
#
# It used to dump only "mebelflow" — the Sobirov and SPS databases
# (mebelflow_sobirov, mebelflow_sps) were never backed up. Databases are now
# discovered from Postgres, so a newly provisioned instance is covered without
# editing this file.
#
# Off-server copy (strongly recommended — a backup on the same disk dies with
# the server). Put ONE of these in /etc/mebelflow/backup.env:
#   OFFSITE_RSYNC="u123456@u123456.your-storagebox.de:mebelflow"   # Hetzner Storage Box / any SSH host
#   OFFSITE_RCLONE="s3remote:bucket/mebelflow"                     # anything rclone supports
# The SSH variant uses root's SSH key (~root/.ssh/id_ed25519); add its .pub to
# the storage box first.
#
# Installed into cron by deploy.sh (03:00 daily). Runs as root and dumps as
# the postgres superuser (peer auth), so it never needs an app DB password.
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/mebelflow/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
[[ -f /etc/mebelflow/backup.env ]] && source /etc/mebelflow/backup.env

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

DATABASES=$(sudo -u postgres psql -Atc "SELECT datname FROM pg_database WHERE datname = 'mebelflow' OR datname LIKE 'mebelflow\_%' ORDER BY datname")
if [[ -z "$DATABASES" ]]; then
  echo "!!! No mebelflow databases found" >&2
  exit 1
fi

failed=0
for db in $DATABASES; do
  out="$BACKUP_DIR/${db}-${TIMESTAMP}.sql.gz"
  if sudo -u postgres pg_dump "$db" | gzip > "$out" && [[ -s "$out" ]]; then
    echo "OK   $db → $out ($(du -h "$out" | cut -f1))"
  else
    echo "FAIL $db" >&2
    rm -f "$out"
    failed=1
  fi
done

# Rotation: drop local dumps older than KEEP_DAYS (both naming schemes).
find "$BACKUP_DIR" -name '*.sql.gz' -mtime "+${KEEP_DAYS}" -delete

if [[ -n "${OFFSITE_RSYNC:-}" ]]; then
  if rsync -a --delete -e "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" "$BACKUP_DIR/" "$OFFSITE_RSYNC/"; then
    echo "OK   off-site copy → $OFFSITE_RSYNC"
  else
    echo "FAIL off-site copy → $OFFSITE_RSYNC" >&2
    failed=1
  fi
elif [[ -n "${OFFSITE_RCLONE:-}" ]]; then
  if rclone sync "$BACKUP_DIR" "$OFFSITE_RCLONE"; then
    echo "OK   off-site copy → $OFFSITE_RCLONE"
  else
    echo "FAIL off-site copy → $OFFSITE_RCLONE" >&2
    failed=1
  fi
else
  echo "WARN no off-site copy configured (see /etc/mebelflow/backup.env)"
fi

exit $failed
