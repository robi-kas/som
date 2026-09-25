# Operations

## Deploy (one server)

Any small VPS (2 vCPU, 2–4 GB RAM) or a PC in the cafe is enough.

```bash
git clone <repo> && cd cafe-platform
npm install                                   # refreshes package-lock.json for the workspace layout
cp deploy/.env.example deploy/.env            # set DOMAIN, passwords, BACKUP_PASSPHRASE
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec \
  -e SEED_ADMIN_PASSWORD='a-long-password-you-choose' api npx prisma db seed
```

- Migrations run automatically every time the API container starts.
- Caddy fetches and renews the HTTPS certificate for `DOMAIN` (ports 80 and 443 must be open).
- The admin must change the seeded password at first sign-in.

Updating: `git pull && docker compose ... up -d --build`. Open orders survive a restart.

## Go live on the cafe laptop (no domain)

This is the setup for one cafe: the laptop runs everything, and staff phones join its Wi-Fi or hotspot.
It is a **separate, clean database**: the practice data from `npm run dev` stays behind.

1. **Stop development mode** (`Ctrl+C` on `npm run dev`). Don't run both at once.
2. **Settings file:**
   ```bash
   cp deploy/.env.example deploy/.env
   nano deploy/.env        # keep DOMAIN=:80, COOKIE_SECURE=false, PRINT_MODE=direct
                           # set POSTGRES_PASSWORD and BACKUP_PASSPHRASE to long random values
   chmod 600 deploy/.env
   ```
   `openssl rand -base64 24` makes a good random value. Save BACKUP_PASSPHRASE in a password manager too.
3. **Start it** (first time takes a few minutes to build):
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
   ```
4. **Create the owner account** (use your own strong password):
   ```bash
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env exec \
     -e SEED_ADMIN_PASSWORD='your-own-strong-password' api npx prisma db seed
   ```
   No demo staff, menu or tables are created. Sign in as `admin`; you'll be asked to change the password.
5. **Open it:** on the laptop `http://localhost`; on phones `http://<laptop IP>` (find it with `hostname -I`).
6. **Set up for real** in Manage: cafe name and logo, menu with photos, stations, tables, printers
   (test page!), payment methods and account numbers, then **each staff member with their own login**.
7. **Start on boot:** `sudo systemctl enable docker`. The containers restart by themselves after a reboot or crash.
8. **Backups:** one runs every 24 h into `deploy/backups/`. Copy that folder off the laptop
   (USB disk or cloud) at least weekly — see *Backups* below.

Update after code changes: `git pull` (or copy the new code), then run the step 3 command again.
Orders, payments and staff are kept.

## Printing

- **API in the cloud** (`PRINT_MODE=agent`): run `apps/print-agent` on a machine inside the cafe — see its README.
- **API on a PC in the cafe** (`PRINT_MODE=direct`): no agent needed.

Put the router, printers and agent/server machine on a UPS.

## Monitoring

- `GET https://DOMAIN/api/v1/health` returns `200 {"status":"ok"}` when the API and database are up.
  Point a free uptime monitor (UptimeRobot, Better Stack) at it with SMS alerts.
- Logs are JSON: `docker compose -f deploy/docker-compose.prod.yml logs -f api`.
  Errors carry a short `ref` that also appears in the message the user sees.
- The admin *Today* screen shows printers offline, late kitchen tickets and pending approvals live.

## Backups

The `backup` service writes an encrypted database dump and a copy of uploaded images every 24 h to
`BACKUP_DIR`, keeping 30 days. **A backup on the same server is not a backup** — copy that folder off
the machine daily, e.g. with rclone to Google Drive / S3 / Backblaze:

```bash
# crontab -e on the server
30 4 * * * rclone sync /path/to/deploy/backups remote:cafe-backups
```

Keep `BACKUP_PASSPHRASE` somewhere other than the server (a password manager).

### Restore drill — do it once a month

```bash
createdb -h localhost -U cafe cafe_restore_test
BACKUP_PASSPHRASE=... ./deploy/restore.sh deploy/backups/cafe-YYYYMMDD-HHMM.dump.gpg \
  postgresql://cafe:PASSWORD@localhost:5432/cafe_restore_test
psql postgresql://cafe:PASSWORD@localhost:5432/cafe_restore_test -c 'select count(*) from "Order";'
```

If the count looks right, the backup works. Write the date in your ops notebook.

## Security checklist

- [ ] Admin password changed from the seed value; every person has their own login.
- [ ] Managers have set a PIN (*Password & PIN* in the user menu).
- [ ] `deploy/.env` is readable only by root; not committed.
- [ ] Only ports 80/443 open to the internet (Postgres is not published).
- [ ] Old staff are **disabled** the day they leave (sessions end immediately).
- [ ] Review *Activity log → money-sensitive actions* weekly.

## Pilot week checklist (run alongside paper)

1. Day 0: menu, stations, printers, tables and staff set up; test page prints from every printer.
2. Every shift: cashier opens the drawer with a counted float; closes it by counting notes and coins.
3. Compare the Z-report (Drawer → report) with the paper tally at close. They must match to the santim.
4. Log every problem (missed ticket, wrong total, confusing screen) with the time — the activity log helps you find it.
5. Exit criteria: one full day where the till matches, no ticket went missing, and staff didn't fall back to paper.

## Known limits

- Receipts are not fiscal receipts (see README).
- Printer text mode can't print Amharic characters; give items a Latin name for tickets.
- Live updates run in a single API process. To run several API instances, replace the in-memory
  event bus (`apps/api/src/events/events.service.ts`) with Postgres LISTEN/NOTIFY or Redis.
