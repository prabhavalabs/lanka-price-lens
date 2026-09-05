# PDF intake

Scheduled collection uses two linked SQLite workflows. Source synchronisation
archives new PDFs and records metadata; each new archive record triggers its own
PDF-processing workflow.

## Scheduled collection

Discovery makes one request to the HARTI archive. A normal scheduled run fetches
publications newer than the newest completed one; the first run fetches only the
latest publication. The VPS timer runs once daily at 18:00 Asia/Colombo with a
randomized delay so weekend publications and VPS downtime are handled without
polling the source repeatedly.

The owner dashboard can rerun either workflow. PDF-processing steps are
independently retryable when their upstream step succeeded and the required
durable input is still available. Retrying an earlier step blocks its downstream
steps until they are rerun. The command-line sync can be date-bounded:

```bash
corepack pnpm foundry sync --backfill --from YYYY-MM-DD --to YYYY-MM-DD
```

The source manifest controls request spacing, retry count, and whether network
collection may run. Re-running a completed range does not redownload objects
already present in R2.

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

## Closing a quarantined document by hand

Some documents cannot be extracted and never will be: a scanned issue without a text layer
(`PDF_OCR_REQUIRED`; OCR is not part of the pipeline), or an issue that carries no price table
(`UNSUPPORTED_DOCUMENT`). In the admin's Knowledge Base, "Mark as reviewed" on a failed document
asks for a short note, resolves its open quarantine entries with that note and the reviewer,
sets the artifact and publication to `reviewed`, and the document leaves the failed list under
the "Reviewed" status. The route is `POST /v1/admin/knowledge-base/:publicationId/review`
(`{ "note": "…" }`). Reviewed documents are not swept again by pending processing.
