#!/usr/bin/env bash
# Health monitor for every MebelFlow instance on this server. Run by cron
# every 5 minutes (installed by deploy.sh); logs to /var/log/mebelflow-health.log.
#
# Checks:
#   - each instance's API answers /health (which also checks its database);
#     instances are found from /etc/mebelflow/server*.env (PORT, default 4000)
#   - disk usage below 90%
#   - a backup newer than 26 hours exists for every database
#
# Alerts: put a Telegram bot in /etc/mebelflow/alerts.env to get a message
# when something breaks and again when it recovers (not every 5 minutes):
#   TELEGRAM_BOT_TOKEN="123456:ABC..."   # from @BotFather
#   TELEGRAM_CHAT_ID="123456789"         # your chat id (e.g. via @userinfobot)
set -uo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/mebelflow/backups}"
STATE_FILE="${STATE_FILE:-/var/lib/mebelflow/health.state}"
[[ -f /etc/mebelflow/alerts.env ]] && source /etc/mebelflow/alerts.env
mkdir -p "$(dirname "$STATE_FILE")"

problems=()

for env_file in /etc/mebelflow/server*.env; do
  [[ -f "$env_file" ]] || continue
  port=$(grep -E '^PORT=' "$env_file" | tail -1 | cut -d= -f2 | tr -d '"'"'"' ')
  port="${port:-4000}"
  name=$(basename "$env_file" .env)
  if ! curl -fsS --max-time 10 "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    problems+=("API ${name} (порт ${port}) не отвечает")
  fi
done

disk=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
if [[ "${disk:-0}" -ge 90 ]]; then
  problems+=("Диск заполнен на ${disk}%")
fi

dbs=$(sudo -u postgres psql -Atc "SELECT datname FROM pg_database WHERE datname = 'mebelflow' OR datname LIKE 'mebelflow\_%'" 2>/dev/null)
for db in $dbs; do
  if [[ -z "$(find "$BACKUP_DIR" -name "${db}-*.sql.gz" -mmin -1560 2>/dev/null | head -1)" ]]; then
    problems+=("Нет свежего бэкапа базы ${db} (старше 26 ч)")
  fi
done

now="$(date '+%F %T')"
if [[ ${#problems[@]} -eq 0 ]]; then
  status="OK"
  message="✅ MebelFlow ($(hostname)): всё снова в порядке"
else
  status="FAIL: $(IFS='; '; echo "${problems[*]}")"
  message="🚨 MebelFlow ($(hostname)):"$'\n'"$(printf -- '- %s\n' "${problems[@]}")"
fi
echo "$now $status"

previous="$(cat "$STATE_FILE" 2>/dev/null || echo OK)"
echo "$status" > "$STATE_FILE"
# Alert on change only: first failure, a different failure, or recovery.
if [[ "$status" != "$previous" && -n "${TELEGRAM_BOT_TOKEN:-}" && -n "${TELEGRAM_CHAT_ID:-}" ]]; then
  curl -fsS --max-time 15 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${message}" >/dev/null \
    || echo "$now telegram send failed"
fi

[[ ${#problems[@]} -eq 0 ]]
