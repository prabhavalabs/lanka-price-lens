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
SQLite `archived_pdf` inventory and R2, and downloads only PDFs newer than the
newest known object. Existing R2 objects missing SQLite metadata are reconciled
without downloading them again.

Each new PDF is uploaded to the private bucket under its deterministic key. Its
source URL, R2 URI, byte size, checksum, upload time, status, and source-sync
execution are then stored in SQLite. A separate PDF-processing execution starts
for every newly archived PDF.

The former Cloudflare Worker Cron Trigger is intentionally empty; deploying the
Worker removes the overlapping Cloudflare schedule.
