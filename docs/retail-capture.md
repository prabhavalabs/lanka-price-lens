# Retail price capture

Retail capture adds supermarket shelf prices next to the HARTI wholesale bulletins.
Each retailer is a **source** with an **adapter**: the adapter knows how that store
publishes prices, and everything after the adapter is shared with the document
pipeline (staging, mapping bundles, canonical observations, quality scoring).

## Sources and adapters

| Source id | Adapter kind | How prices are read | Session |
| --- | --- | --- | --- |
| `spar_online_prices` | `spar_shopify` | Public Shopify feed `GET /collections/<handle>/products.json` per collection page | none |
| `glomark_online_prices` | `glomark_html` | Server-rendered category pages, parsed from the product cards | none |
| `keells_online_prices` | `keells_api` | `POST /1.0/Login/GuestLogin` then `GET /2.0/WebV2/GetItemDetails` per department, as the web app does | guest session id + cookies |
| `cargills_online_prices` | `cargills_api` | `GET /`, `POST /Web/CheckDeliveryOptionV1` (store for the delivery area), then `POST /Web/GetMenuCategoryItemsPagingV3/` per category | cookies |

Manifests live in `data/manifests/<source id>.json` and carry
`"retrieval_method": "api_snapshot"` plus an `adapter` block:

```json
"adapter": { "kind": "keells_api", "settings": { "departmentIds": [16] } }
```

Mapping bundles live in `data/mappings/<source id>.json`. They reuse the HARTI
product and item ids where the same commodity exists (so "Carrot" at Keells and
"Carrot" in the Dambulla bulletin are the same canonical item) and add one
`online_store` market per retailer. Every manifest in the directory is loaded by
the API and the scheduler; a manifest without a bundle still captures, but its
records stay in staging with quality status `not_configured`.

## The capture workflow

Workflow `retail_price_capture` runs daily at 06:30 Asia/Colombo for every retail
source (one dispatch per source). Stages:

1. `fetch_snapshot`: the adapter fetches the listing. Requests use bounded retries
   with exponential backoff and jitter, a per-request timeout, and a body-size cap.
   4xx responses are not retried; 429 and 5xx are.
2. `normalize_records`: the adapter turns the payload into the unified record shape
   (row reference, item label, market label, date, pack quantity and unit, price in
   minor units). Duplicate row references are dropped.
3. `validate_records`: rows with missing labels, non-positive prices, or impossible
   quantities are rejected and counted. The snapshot is **held for review** when it
   has fewer than `minimumRecords` rows or its row count swings more than
   `maxRecordCountChangePct` against the previous snapshot. Held snapshots finish
   the run as `blocked`, write a `quarantine` row, and store nothing.
4. `store_snapshot`: the sorted records are hashed (sha256). One
   `source_publication` exists per source and trading day (`snapshot_<date>`); one
   `source_artifact` exists per distinct content hash. An identical re-capture is a
   no-op ("unchanged"). Otherwise the full evidence (settings, records, raw payload)
   is uploaded to the archive under `sources/<id>/snapshots/<yyyy>/<mm>/`, the
   artifact and staging rows are written in one transaction, and earlier snapshots
   for the same day are marked stale.
5. `canonicalize_data`: completeness is scored and the mapping bundle promotes mapped
   rows to `price_observation` with `price_type = 'retail_online_store'`. Pack prices
   are normalised to the canonical unit (500 g at Rs 180 becomes Rs 360 per kg).

## Fault tolerance

- **One run per source at a time.** `startRun` takes a lease; a second capture while
  one is running is skipped as `RUN_ALREADY_ACTIVE`.
- **No duplicates.** Staging rows are unique per artifact and row reference;
  artifacts are unique per publication and content hash; canonical promotion reuses
  the existing lineage and effective-key checks.
- **Circuit breaker.** After `maxConsecutiveFailures` failures in a row the source
  is paused: 6 h, then 12 h, 24 h, capped at 48 h. Scheduled captures are skipped
  with `CAPTURE_PAUSED` until the pause lapses or an operator resumes the source.
  Invalid settings fail the run with `SETTINGS_INVALID` but do not count as a
  source failure.
- **Evidence first.** Every stored snapshot is kept verbatim in the archive, so a
  parser change can be replayed without re-fetching.
- **Time zone.** Snapshots are filed under the Sri Lanka calendar day.

## Managing it from the admin portal

The **Sources** page shows a card per retailer with:

- health (state, failures in a row, pause until, last error) and the last run;
- **Capture now** and **Resume** buttons;
- a settings form generated from the adapter's schema. Blank fields inherit the
  manifest defaults; changed fields are saved as overrides in
  `source_adapter_setting` after the merged result is validated, and every change is
  written to `audit_event`.

The **Automations** page lists "Capture supermarket prices" with its schedule, and
"Run now" queues one capture per enabled retail source. Run history shows the five
stages with plain-language labels.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/admin/sources/:id/adapter` | Adapter, JSON schema, defaults, overrides, effective settings, health, last run |
| PUT | `/v1/admin/sources/:id/adapter` | Save overrides (`{ "overrides": { ... } }`); 400 with `issues` when invalid |
| DELETE | `/v1/admin/sources/:id/adapter` | Reset overrides to the manifest defaults |
| POST | `/v1/admin/sources/:id/capture` | Start a capture now (202), 409 when paused or already running |
| POST | `/v1/admin/sources/:id/resume` | Clear the pause and failure streak |

## Command line

```bash
pnpm --filter @lanka-pricelens/foundry cli capture --source keells_online_prices
```

Add `--date YYYY-MM-DD` to file the snapshot under another trading day and
`--no-archive` to skip the evidence upload locally. `LPL_MANIFESTS_DIR` and
`LPL_MAPPINGS_DIR` point the CLI, scheduler, and API at the manifest and bundle
directories (defaults: `data/manifests`, `data/mappings`).

## Shared adapter settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `requestTimeoutMs` | 30000 | Per-request timeout |
| `maxAttempts` | 3 | Attempts per request before the capture fails |
| `minimumRecords` | 20 | Fewer rows than this holds the snapshot for review |
| `maxConsecutiveFailures` | 3 | Failures in a row before the source is paused |
| `maxRecordCountChangePct` | 50 | Largest row-count swing against the previous snapshot before review |

Each adapter adds its own fields (collections, department ids, outlet code,
delivery area, category paths, page sizes). The admin form lists them all with
their descriptions.

## Rights position

Retail manifests are marked `rights_status: "internal_evaluation"`. Captures are
allowed in that state (see `canCaptureSource`), but the sources are **not** eligible
for public release (`canPublishSource` still requires `approved_open` or
`approved_permission`). The retailers list these prices publicly; the review of
their terms of use is the owner's decision and must be recorded before anything
derived from them is redistributed.

## Adding a retailer

1. Write an adapter in `foundry/src/retail/adapters/` implementing `RetailAdapter`
   (settings schema extending `baseSettingsSchema`, `fetch`, `normalize`).
2. Register it in `foundry/src/retail/index.ts` and add its kind to
   `retailAdapterKinds` in `shared/src/index.ts`.
3. Add a manifest and a mapping bundle under `data/`.
4. Capture a fixture payload into `foundry/test/fixtures/retail/` and cover
   `normalize` in `foundry/test/retail.test.ts`.
