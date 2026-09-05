# PDF archive

The private `lanka-price-lens-pdfs` R2 bucket stores unprocessed HARTI source
PDFs under deterministic `sources/harti/daily-food-prices/YYYY/MM/YYYY-MM-DD/`
keys. Reruns list R2 first and skip existing objects; source requests remain
serial and five seconds apart during the one-time backfill. Cloudflare upload
throttling is retried with a one-minute backoff.

## Historical transfer

Authenticate Wrangler, then run the resumable archive-only backfill:

```bash
corepack pnpm archive backfill
```

Check live R2 progress with `corepack pnpm archive status`.

Wrangler authentication is used locally. CI or a VPS can instead set
`CLOUDFLARE_ACCOUNT_ID` and a scoped `CLOUDFLARE_API_TOKEN` with R2 object write
permission. No PDFs are parsed and no permanent local copies are created.

## Daily collection

The VPS systemd timer is the single scheduler. At 18:00 Asia/Colombo it runs
`foundry sync`, compares the complete official publication list with both the
SQLite `archived_pdf` inventory and R2, and downloads the PDFs newer than the
newest known object plus any hole inside the last 45 days (a day whose download
failed, or one a store that started mid-series never had). Older gaps are left
to an explicit backfill (`ingest --backfill --from … --to …`), so the historical
archive is never pulled by accident. Existing R2 objects missing SQLite metadata
are reconciled without downloading them again.

Each new PDF is uploaded to the private bucket under its deterministic key. Its
source URL, R2 URI, byte size, checksum, upload time, status, and source-sync
execution are then stored in SQLite. A separate PDF-processing execution starts
for every newly archived PDF.

After each source's sync, the same run processes archived documents whose prices
never landed: a processing run that never started (a sync interrupted after the
download, an archive filled before processing existed) or one that ran without a
mapping bundle and published nothing. Newest documents go first, up to
`--process-limit` (default 150) per run, so a large backlog drains over a few
days while each timer run stays bounded. Quarantined documents and documents
that already failed three times while being examined wait for an operator; a
fetch the archive refused (an outage, a rate limit) never counts against the
document, and a sweep that meets HTTP 429 pauses with a doubling backoff (30 s
to 10 min) instead of spending its budget on refusals. `foundry process
[--source <id>] [--limit N] [--since yyyy-mm-dd]` runs the same sweep on demand,
and the admin API offers it as `POST /v1/admin/sources/:id/process-pending`
(`{ "limit", "since" }`) next to `POST /v1/admin/sources/:id/sync`
(`{ "mode": "sync" | "backfill", "from", "to", "limit" }`); both answer 202 and
refresh the warehouse when they finish, so the explorer shows the prices without
waiting for the evening timer.

The former Cloudflare Worker Cron Trigger is intentionally empty; deploying the
Worker removes the overlapping Cloudflare schedule.
