# PDF intake

Both scheduled downloads and owner uploads use the same SQLite run, stage,
artifact, extraction, parsing, and quarantine records.

## Scheduled collection

Discovery makes one request to the HARTI archive. A normal scheduled run fetches
publications newer than the newest completed one; the first run fetches only the
latest publication. The VPS timer runs once daily at 18:00 Asia/Colombo with a
randomized delay so weekend publications and VPS downtime are handled without
polling the source repeatedly.

The owner dashboard's **Ingest full archive** action starts a monitored,
idempotent background import of every unprocessed archive PDF. The command-line
equivalent can be date-bounded:

```bash
corepack pnpm foundry ingest --backfill --from YYYY-MM-DD --to YYYY-MM-DD
```

The source manifest controls request spacing, retry count, and whether network
collection may run. Re-running a completed range does not parse completed
artifacts again.

## Manual inspection

The owner dashboard accepts one PDF up to 20 MiB. The API verifies the filename,
media type, PDF signature, size, and SHA-256 checksum before processing. The
original bytes are not retained under the current metadata-and-checksum policy.

PDF Inspector classifies each document and records page count, confidence,
complex layout, tables, and pages requiring OCR. Text-based documents continue
through positioned extraction and the HARTI parser. Scanned, mixed, unsupported,
or changed templates enter quarantine instead of producing partial data.

The Node binding does not bundle the optional OCR models. OCR-required pages are
therefore explicitly quarantined until a self-hosted PDF Inspector OCR worker is
added and validated; no paid or hosted OCR service is used.

## Local end-to-end check

```bash
corepack pnpm install
corepack pnpm check
corepack pnpm --filter @lanka-pricelens/foundry cli init
corepack pnpm build
```

Start the API with the database, admin credentials, admin build, and source
manifest environment variables from `.env.example`, then open `/admin/` and use
**Manual PDF intake**. The upload and its run stages appear immediately in the
dashboard.
