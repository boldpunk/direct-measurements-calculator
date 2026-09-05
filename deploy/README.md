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

```
sudo cp deploy/backup-db.sh /opt/mebelflow/deploy/backup-db.sh   # already there after deploy.sh's clone
sudo tee /etc/cron.d/mebelflow-backup <<'EOF'
0 3 * * * root /opt/mebelflow/deploy/backup-db.sh >> /var/log/mebelflow-backup.log 2>&1
EOF
```

Dumps land in `/opt/mebelflow/backups/`, gzip'd, with the last 14 days kept.
Copy them off the server periodically (e.g. `scp` to your laptop, or sync to
object storage) — a backup that only lives on the same disk as the database
doesn't protect against the server itself failing.

## Day-to-day operations

- **Logs**: `sudo journalctl -u mebelflow-api -f`
- **Restart API only**: `sudo systemctl restart mebelflow-api`
- **Restore a backup**: `gunzip -c backups/mebelflow-*.sql.gz | sudo -u postgres psql mebelflow`
- **Update the app**: `sudo bash deploy/deploy.sh` (safe to re-run anytime; only
  migrates the schema forward, never touches existing rows)

## What you're responsible for that Render/Netlify used to handle

- OS security updates (`sudo apt-get update && sudo apt-get upgrade` periodically)
- Postgres backups (set up in step 7 — actually verify a restore works once)
- Disk space (`df -h` — logs and backups both grow over time)
- Certbot's renewal runs automatically via a systemd timer, but it's worth
  checking `sudo certbot renew --dry-run` once after setup
