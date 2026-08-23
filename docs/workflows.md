# Workflow scheduling and monitoring

Lanka PriceLens uses the same Foundry scheduler code locally and in a container.
The scheduler is a separate long-running process; API requests only validate and
enqueue durable dispatch records in SQLite.

## Workflow registry

Definitions are versioned in `foundry/src/workflows.ts`. Only registered
workflows can be dispatched:

- **Latest Document Collection** runs hourly at minute 15 in Asia/Colombo and
  processes at most 5 newly published documents per occurrence.
- **Historical Backfill** runs daily at 00:15 in Asia/Colombo and fills at most
  25 missing documents per occurrence.
- **Document Processing Pipeline** is normally event-driven. A five-minute
  recovery schedule finds archived documents without a successful processing
  run and queues at most 10 at a time.

Each schedule occurrence is inserted into `workflow_dispatch` with a unique
idempotency key before execution. SQLite transactions prevent two scheduler
instances from claiming the same dispatch. Source leases separately prevent
overlapping source syncs and duplicate document processing.

## Local execution

Use absolute paths so the API and scheduler share the intended SQLite file:

```bash
export LPL_DATABASE_PATH=/absolute/path/to/data/runtime/local-validation.sqlite
export LPL_SOURCE_MANIFEST_PATH=/absolute/path/to/data/manifests/harti_daily_food_prices.json
export LPL_ARCHIVE_DRIVER=filesystem
export LPL_LOCAL_ARCHIVE_ROOT=/absolute/path/to/data/raw/archive
export LPL_ENVIRONMENT=local
export LPL_SCHEDULER_ENABLED=true
pnpm dev:scheduler
```

The local archive is isolated from production R2 and is ignored by Git. It
stores sidecar metadata next to each PDF so list, upload, and download semantics
match the production adapter. Never place credentials in these paths or in a
repository runbook.

The Workflows page exposes definitions, execution history, schedules,
heartbeats, and the durable dispatch queue. A scheduler heartbeat is considered
stale after 45 seconds. Knowledge Base rows show their latest processing result
and link to full step logs; reruns enqueue a new immutable dispatch and preserve
prior history.

The document-processing pipeline has seven durable steps: retrieve the PDF,
inspect/extract its text, adaptively parse the price grid, validate the staged
rows, persist them, assess structural completeness, and promote reviewed exact
mappings into canonical observations. Completeness and parser confidence are
separate signals. A structurally incomplete document may retain valid canonical
rows while remaining visibly flagged for review.

## Adaptive PDF parsing

The document-processing workflow does not depend on a page number or one exact
header string. It evaluates labelled market/date grids, inferred market/date
grids, and legacy min/max grids across all pages. Header text, punctuation, date
separators, and known market spellings are normalized before matching. When a
label header is absent, table geometry may be used only if HARTI identity,
market, date, and price signals still pass semantic validation.

Every accepted parse records its strategy, confidence, matching signals,
warnings, page number, and rejected candidate layouts. These diagnostics appear
in the workflow step output, while the Knowledge Base shows the accepted parser
confidence. Documents below the safe confidence threshold remain quarantined:
recognizable HARTI documents use `SOURCE_TEMPLATE_CHANGED`, while unrelated
documents use `UNSUPPORTED_DOCUMENT`. Adding a new template family requires a
representative fixture and a rejection regression test; confidence thresholds
must not be weakened merely to make a single file pass.

## Production transition

The existing persistent systemd timer remains the production scheduler until a
deliberate cutover. To test the long-running container scheduler, use the
`scheduler` Compose profile. Do not enable it alongside the legacy timer as a
permanent configuration: overlap leases are safe, but duplicate source checks
are unnecessary. During cutover, stop and disable the timer, enable the
scheduler container, and confirm its heartbeat in the Cron monitor.

Cloudflare credentials remain external environment secrets. Production must use
`LPL_ARCHIVE_DRIVER=cloudflare`; local validation should use `filesystem`.
