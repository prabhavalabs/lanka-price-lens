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

The `archive/` Worker runs at 12:30 UTC (18:00 Asia/Colombo), checks the latest
fourteen publication keys, and stores at most two missing PDFs per run. Deploy
the Worker and its Cron Trigger with:

```bash
corepack pnpm deploy:archive
```

The bucket stays private. Each scheduled object includes its source URL, source
date, and SHA-256 checksum as R2 metadata. Cron execution logs are available in
Cloudflare Workers observability.
