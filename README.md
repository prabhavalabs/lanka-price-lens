# Lanka PriceLens

Open, provenance-rich infrastructure for Sri Lankan price observations.

The repository is backend-first:

- `archive/` provides the private R2 client and resumable historical transfer;
- `foundry/` owns scheduled source sync plus per-PDF processing, validation, and release;
- `api/` exposes public health and authenticated operational data;
- `admin/` is the single-owner operations interface;
- `shared/` contains the source and API contracts;
- `data/manifests/` records source rights and operating policy;
- `deploy/` contains the VPS packaging and scheduler units.

## Local check

```bash
corepack enable
pnpm install
pnpm check
```

## Current backend milestone

- Node.js 24 monorepo with pnpm and strict TypeScript;
- WAL-mode SQLite operational database and overlap-resistant run leases;
- rights-gated HARTI archive discovery, bounded downloads, PDF Inspector
  classification, coordinate parsing, idempotent artifacts, and quarantine;
- owner-triggered full historical ingestion plus daily incremental collection;
- routed React owner portal using the supplied Shadcn preset, TanStack Query,
  React Hook Form, and minimal Zustand UI state;
- scrypt-protected SQLite administrator and revocable HttpOnly cookie sessions;
- Docker packaging and a persistent VPS systemd timer;
- reviewed exact-label mappings, validation and quarantine resolution;
- correction-safe canonical observations and immutable release candidates in
  SQLite, CSV, JSON, manifest, checksum, notice, and release-note formats.
- owner-only manual PDF intake with checksum deduplication, OCR routing, and
  run-stage monitoring in the ShadCN operations interface.

Public promotion, the consumer read API, and the trend interface intentionally
follow this operational foundation. See
[`docs/self-hosting.md`](docs/self-hosting.md) for deployment and
[`docs/release-process.md`](docs/release-process.md) for candidate building.
See [`docs/pdf-intake.md`](docs/pdf-intake.md) for scheduled and manual PDF
processing and [`docs/pdf-archive.md`](docs/pdf-archive.md) for R2 archival.

The HARTI source is enabled for non-commercial data preparation under recorded
permission. See [`docs/source-permission.md`](docs/source-permission.md).
