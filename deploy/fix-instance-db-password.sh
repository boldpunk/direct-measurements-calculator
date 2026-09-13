#!/usr/bin/env bash
# Regenerates a URL-safe Postgres password for an instance whose env file
# was written with the old openssl-base64 password generator (see
# provision.sh / provision-second-instance.sh — base64 can contain '/' or
# '+', which breaks Prisma's DATABASE_URL parsing when unescaped). Updates
# the Postgres role to match and rewrites the instance's env file in place.
#
# Run as root: sudo bash fix-instance-db-password.sh <instance-slug>
# e.g.:        sudo bash fix-instance-db-password.sh sps
set -euo pipefail

INSTANCE="${1:?Usage: fix-instance-db-password.sh <instance-slug>}"
ENV_FILE="/etc/mebelflow/server-${INSTANCE}.env"
DB_USER="mebelflow_${INSTANCE}"
DB_NAME="mebelflow_${INSTANCE}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "No such env file: $ENV_FILE" >&2
  exit 1
fi

NEW_PASSWORD="$(openssl rand -hex 24)"
sudo -u postgres psql -c "ALTER ROLE ${DB_USER} WITH PASSWORD '${NEW_PASSWORD}';"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${DB_USER}:${NEW_PASSWORD}@localhost:5432/${DB_NAME}|" "$ENV_FILE"

echo "==> Password rotated for role ${DB_USER}; ${ENV_FILE} updated."
