# Self-hosting

The production shape is one Node.js container, one SQLite volume, and one
systemd timer. Put a TLS reverse proxy in front of the API container.

## First start

1. Copy `.env.example` to `.env`, choose the local bind and application port,
   and set the administrator email.
2. Generate a password hash locally:

   ```bash
   corepack pnpm foundry hash-password 'a-long-unique-password'
   ```

3. Put the output in `ADMIN_PASSWORD_HASH`, then start the API:

   ```bash
   docker compose up -d --build api
   ```

The operations interface is served at `/admin/`. The first start seeds the
SQLite administrator from `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`. Signing in
creates a hashed, revocable server session and sends only an HttpOnly,
SameSite=Strict cookie to the browser. Changing the configured password hash
rotates the password and revokes existing sessions at the next start.

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

Use **Ingest full archive** in the owner dashboard, or run a bounded backfill:

```bash
docker compose --profile tools run --rm foundry ingest --backfill --from YYYY-MM-DD --to YYYY-MM-DD
```

Backfills are serial and rate-limited. Failed publications are quarantined;
successful artifacts remain idempotent by publication key and checksum.

## Backup and upgrade

Stop the API briefly and copy the named volume's `operations.sqlite` file plus
its WAL files. To upgrade, pull the repository and run `docker compose up -d
--build api`; schema migrations are additive and run at process startup.

## Production delivery

The `Delivery` GitHub Actions workflow validates every pull request. After a
merge to `main`, it builds the API and admin portal once, publishes an immutable
commit-tagged image to GHCR, and deploys it through the restricted VPS account.
The server pulls the image before stopping the current container, snapshots the
SQLite volume, waits for the container health check, and restores the previous
image when deployment fails.

Production uses `/etc/lanka-price-lens/app.env` for application secrets and
`/etc/lanka-price-lens/release.env` for the deployed image. Neither belongs in
the repository. The VPS binds the application to loopback and the Nginx template
in `deploy/nginx/` exposes the single public hostname. The admin portal remains
at `/admin/` and the API remains under `/v1/`; a second API hostname is not
required.

The workflow expects the `production` environment secrets `VPS_HOST`,
`VPS_USER`, `VPS_SSH_KEY`, and `VPS_KNOWN_HOSTS`. Set the repository variable
`VPS_DEPLOY_ENABLED=true` only after DNS and TLS are ready. Cloudflare Worker
delivery similarly requires `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_DEPLOY_ENABLED=true`.
