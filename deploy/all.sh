#!/usr/bin/env bash
# Deploy every instance on this server in one go.
#
# Exists because the Hetzner web console mangles pasted commands — it drops
# the space in `bash deploy/deploy.sh` and joins multi-line pastes into one
# line. This takes no arguments and no shell operators, so it survives:
#
#   sudo /opt/mebelflow/deploy/all.sh
#
# Add or remove instances by editing the INSTANCES list below.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$SELF_DIR/deploy.sh"

# "app dir|env file|service name" — the main instance uses deploy.sh's own
# defaults, so its fields are left empty.
INSTANCES=(
  "|||main (mebelflow.uz)"
  "/opt/mebelflow-sobirov|/etc/mebelflow/server-sobirov.env|mebelflow-api-sobirov|Sobirov Mebel"
  "/opt/mebelflow-sps|/etc/mebelflow/server-sps.env|mebelflow-api-sps|sps.mebelflow.uz"
)

failed=()

for entry in "${INSTANCES[@]}"; do
  IFS='|' read -r app_dir env_file service label <<< "$entry"

  echo
  echo "############################################################"
  echo "### Deploying: $label"
  echo "############################################################"

  # A missing app dir means that instance isn't provisioned here — skip it
  # rather than letting deploy.sh clone a fresh copy into the wrong place.
  if [[ -n "$app_dir" && ! -d "$app_dir" ]]; then
    echo "--> $app_dir not found on this server, skipping"
    continue
  fi

  if [[ -z "$app_dir" ]]; then
    "$DEPLOY"
  else
    "$DEPLOY" "$app_dir" "$env_file" "$service"
  fi

  if [[ $? -ne 0 ]]; then
    echo "!!! FAILED: $label"
    failed+=("$label")
  fi
done

echo
echo "############################################################"
if [[ ${#failed[@]} -eq 0 ]]; then
  echo "### All instances deployed successfully"
else
  echo "### Finished with failures: ${failed[*]}"
  exit 1
fi
echo "############################################################"
