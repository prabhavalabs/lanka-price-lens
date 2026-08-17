# Lanka PriceLens

Open, provenance-rich infrastructure for Sri Lankan price observations.

The repository is backend-first:

- `foundry/` discovers, fetches, parses, validates, quarantines, and releases;
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
- rights-gated HARTI archive discovery, bounded downloads, PDF text evidence,
  coordinate parsing, idempotent artifacts, and quarantine records;
- immediate scheduled ingestion plus explicit date-bounded historical backfill;
- scrypt-protected owner dashboard built from Shadcn UI primitives;
- Docker packaging and a persistent VPS systemd timer;
- reviewed exact-label mappings, validation and quarantine resolution;
- correction-safe canonical observations and immutable release candidates in
  SQLite, CSV, JSON, manifest, checksum, notice, and release-note formats.

Public promotion, the consumer read API, and the trend interface intentionally
follow this operational foundation. See
[`docs/self-hosting.md`](docs/self-hosting.md) for deployment and
[`docs/release-process.md`](docs/release-process.md) for candidate building.

The HARTI source is intentionally rights-blocked. See
[`docs/source-policy.md`](docs/source-policy.md) before enabling collection or
publication.
