# Canonicalization and release candidates

This workflow builds private release candidates only. It does not publish a
candidate or enable a source. Public promotion remains unavailable until the
source rights decision and data-steward review are recorded.

## 1. Review mappings

Create a version-controlled JSON bundle under `data/mappings/` that satisfies
`mappingBundleSchema` in `shared/src/index.ts`. Every exact source label and
unit rule must include a mapping version, reviewer, date, and evidence
reference. Fuzzy or guessed mappings are not accepted.

Unknown items, markets, and units remain quarantined. A later reviewed bundle
can resolve them. Changed semantic mappings create a new observation and mark
the previous observation as superseded.

## 2. Canonicalize one run

```bash
corepack pnpm foundry canonicalize \
  --run RUN_ID \
  --mappings data/mappings/SOURCE.json \
  --parser-version CONNECTOR@VERSION
```

Review the map and validation stages plus quarantine records in `/admin/`.

## 3. Build an immutable candidate

The builder requires an approved, current source manifest, at least one active
observation, and zero unresolved quarantine records in contributing runs.

```bash
corepack pnpm foundry release build \
  --version YYYY-MM-DD.N \
  --commit GIT_COMMIT \
  --actor RELEASE_MANAGER \
  --notes "Summary of mapping and coverage changes"
```

The output directory contains SQLite, CSV, JSON, a manifest, checksums,
attribution notices, and release notes. Existing data versions and directories
are never overwritten. The candidate and checksum are recorded in the
operational database and appear in the admin dashboard.

## Failure behavior

- Unknown mappings and source corrections enter quarantine.
- An open quarantine record blocks candidate creation.
- A failed build is removed before it is recorded.
- Existing candidates and earlier observations remain unchanged.
- No command currently promotes, withdraws, or publicly serves a candidate.
