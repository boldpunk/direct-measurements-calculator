# Deploying MebelFlow to a single VPS (Hetzner)

Everything — frontend, API, and PostgreSQL — runs on one server, on one
domain (`mebelflow.uz`). Nginx serves the built frontend and reverse-proxies
`/api` and `/health` to the local Express process, so the browser never
leaves `mebelflow.uz` and there's no CORS to configure.

## 1. Buy the server

[Hetzner Cloud](https://www.hetzner.com/cloud/) → create a **CX22** server
(2 vCPU / 4GB RAM / 40GB SSD, ~€4.59/mo), image **Ubuntu 22.04** or **24.04**.
Add your SSH key during creation. Note the server's public IP.

## 2. Point the domain at it

In Namecheap's DNS for `mebelflow.uz` (Domain List → Manage → Advanced DNS,
or the hosting's DNS zone if nameservers point there instead):

| Type | Host | Value |
|---|---|---|
| A | `@` | the server's IP |
| A | `www` | the server's IP |

DNS propagation can take anywhere from minutes to ~24h.

## 3. Provision the server

SSH in as root, copy this `deploy/` folder to the server (or just clone the
repo there once and use it from `/opt/mebelflow`), then:

```
sudo bash deploy/provision.sh
```

This installs Node 20, PostgreSQL, Nginx, certbot, creates the `mebelflow`
system user + database, writes `/etc/mebelflow/server.env` (random DB
password + JWT secret, generated once — re-running the script won't
overwrite it), installs the systemd service and Nginx site, and opens the
firewall (SSH + HTTP/HTTPS only).

## 4. First deploy

```
sudo bash deploy/deploy.sh
```

Clones the repo into `/opt/mebelflow` (or pulls latest if already cloned),
builds the frontend with a relative `/api` base (same-origin — no
`VITE_API_URL` needed), runs Prisma migrations, and starts the
`mebelflow-api` systemd service.

Re-run the same command for every future release — it's the one command
that updates the whole app.

## 5. Enable HTTPS

Once DNS has propagated:

```
sudo certbot --nginx -d mebelflow.uz -d www.mebelflow.uz
```

Certbot edits the Nginx config to add the HTTPS server block and the
HTTP→HTTPS redirect, and sets up auto-renewal. Don't hand-edit the SSL
block into `nginx/mebelflow.conf` yourself — let certbot do it.

## 6. Seed the database (first time only)

The seed script **wipes the database** before reseeding — only ever run
it once, right after the first deploy, before real data exists:

```
cd /opt/mebelflow/server
node prisma/seed.js
```

## 7. Nightly backups

Nothing to do by hand: every `deploy.sh` run installs
`/etc/cron.d/mebelflow-backup` (03:00 daily). `backup-db.sh` dumps **every**
MebelFlow database it finds (`mebelflow`, `mebelflow_sobirov`,
`mebelflow_sps`, …) into `/opt/mebelflow/backups/`, keeping 14 days.

**Off-server copy** — a backup on the same disk dies with the server. Create
`/etc/mebelflow/backup.env` with one of:

```
OFFSITE_RSYNC="u123456@u123456.your-storagebox.de:mebelflow"   # Hetzner Storage Box / any SSH host
OFFSITE_RCLONE="s3remote:bucket/mebelflow"                     # anything rclone supports
```

(for the SSH variant, add root's public key to the storage box first).

**Check that backups restore** (loads the latest dump of each database into a
throw-away database and counts orders; production is never touched):

```
sudo /opt/mebelflow/deploy/check-backups.sh
```

Run a backup now: `sudo /opt/mebelflow/deploy/backup-db.sh`.

`deploy.sh` also takes a dump of the instance's database right before
`prisma migrate deploy`, so every release has an exact "before" copy in the
same folder.

## 8. Health monitoring

`deploy.sh` installs `/etc/cron.d/mebelflow-healthcheck` (every 5 minutes).
`healthcheck.sh` checks that each instance's API answers `/health` (which
also queries its database), that the disk is below 90%, and that every
database has a backup younger than 26 hours. Results go to
`/var/log/mebelflow-health.log`.

To get a Telegram message when something breaks (and once more when it
recovers), create `/etc/mebelflow/alerts.env`:

```
TELEGRAM_BOT_TOKEN="123456:ABC..."   # create a bot with @BotFather
TELEGRAM_CHAT_ID="123456789"         # your id, e.g. from @userinfobot; write to the bot once first
```

Test it: `sudo /opt/mebelflow/deploy/healthcheck.sh`.

## 9. Safety net for changes

- **CI** (`.github/workflows/ci.yml`) builds the frontend and runs the API
  tests (`server/test`) against a fresh Postgres with the seed data on every
  push. Deploy only commits with a green run. Locally: `cd server && npm test`.
- **Deploy** builds the frontend into `dist-next` and swaps it in only when
  the build succeeds (the previous build is kept as `dist-prev`), dumps the
  database before migrating, and fails loudly if the API isn't healthy
  within 30 s of the restart.
- **Data-migration endpoints** (`/api/migration/*`, used once for the
  Render → Hetzner move; `/import` wipes every table) are off. Set
  `ENABLE_MIGRATION_ROUTES=1` in the instance's env file only for the
  duration of a transfer.

## Adding a second company on the same server

Each company gets its own app directory, database, systemd service and
Nginx site (its own subdomain) — full data isolation, sharing only the
server's Node/Postgres/Nginx install. To add one (e.g. "sobirov" →
`sobirov.mebelflow.uz`):

```
INSTANCE=sobirov DOMAIN=sobirov.mebelflow.uz PORT=4001 \
  sudo -E bash deploy/provision-second-instance.sh
```

Pick a `PORT` that isn't already used by another instance (the first one
uses 4000). It prints the exact follow-up commands, which mirror steps 4–6
above but scoped to the new instance:

```
sudo bash /opt/mebelflow/deploy/deploy.sh /opt/mebelflow-sobirov /etc/mebelflow/server-sobirov.env mebelflow-api-sobirov

sudo certbot --nginx -d sobirov.mebelflow.uz

cd /opt/mebelflow-sobirov/server
set -a; source /etc/mebelflow/server-sobirov.env; set +a
node prisma/seed-fresh.js "Sobirov Mebel" "<admin name>" "<admin email>" "<admin password>"
```

`seed:fresh` (unlike `seed.js`) only creates the Settings row and one admin
login — no demo employees/orders, since this is a real company's database
from day one. Every future update to *this* instance re-uses the same
`APP_DIR`/`ENV_FILE`/`SERVICE_NAME` env vars with `deploy.sh`.

## Day-to-day operations

- **Logs**: `sudo journalctl -u mebelflow-api -f`
- **Restart API only**: `sudo systemctl restart mebelflow-api`
- **Roll back the frontend**: `cd /opt/mebelflow && sudo rm -rf dist && sudo mv dist-prev dist`
- **Restore a backup** (into an empty database): `gunzip -c /opt/mebelflow/backups/<db>-<date>.sql.gz | sudo -u postgres psql <db>`
- **Update the app**: `sudo bash deploy/deploy.sh` (safe to re-run anytime; only
  migrates the schema forward, never touches existing rows)

## What you're responsible for that Render/Netlify used to handle

- OS security updates (`sudo apt-get update && sudo apt-get upgrade` periodically)
- Postgres backups (set up in step 7 — actually verify a restore works once)
- Disk space (`df -h` — logs and backups both grow over time)
- Certbot's renewal runs automatically via a systemd timer, but it's worth
  checking `sudo certbot renew --dry-run` once after setup
