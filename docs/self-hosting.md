# Self-hosting

The production shape is one Node.js container, one SQLite volume, and one
systemd timer. Put a TLS reverse proxy in front of the API container.

## First start

1. Copy `.env.example` to `.env`, choose the local bind and application port,
   and set the owner username.
2. Generate a password hash locally:

   ```bash
   corepack pnpm foundry hash-password 'a-long-unique-password'
   ```

3. Put the output in `ADMIN_PASSWORD_HASH`, then start the API:

   ```bash
   docker compose up -d --build api
   ```

The operations interface is served at `/admin/`. The browser's HTTP Basic
prompt protects both the interface and its read-only operational endpoints.

## Scheduler

Copy the units in `deploy/systemd/` to `/etc/systemd/system/`, adjust their
working directory if required, then enable the timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lanka-pricelens-foundry.timer
systemctl list-timers lanka-pricelens-foundry.timer
```

The timer is persistent, so a missed run executes after the VPS returns. The
database lease rejects overlaps and expires abandoned runs after 30 minutes.

## Backfill

After the source manifest has a recorded permission or open-license evidence,
set it to an approved status and enable it. Then run a bounded backfill:

```bash
docker compose --profile tools run --rm foundry ingest --backfill --from YYYY-MM-DD --to YYYY-MM-DD
```

Backfills are serial and rate-limited. Failed publications are quarantined;
successful artifacts remain idempotent by publication key and checksum.

## Backup and upgrade

Stop the API briefly and copy the named volume's `operations.sqlite` file plus
its WAL files. To upgrade, pull the repository and run `docker compose up -d
--build api`; schema migrations are additive and run at process startup.
