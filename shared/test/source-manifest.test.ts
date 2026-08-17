import assert from "node:assert/strict";
import test from "node:test";

import { canPublishSource, mappingBundleSchema, sourceManifestSchema } from "../src/index.ts";

const baseManifest = {
  id: "synthetic_prices",
  name: "Synthetic prices",
  owner: "Lanka PriceLens",
  landing_url: "https://example.invalid/prices",
  retrieval_method: "manual" as const,
  expected_cadence: "weekly" as const,
  formats: ["json" as const],
  geographic_scope: "synthetic",
  price_types: ["retail_observed"],
  rights_status: "approved_open" as const,
  rights_evidence_ref: "docs/fixtures.md",
  attribution_text: "Synthetic Lanka PriceLens fixture",
  retention_policy: "preserve_source_evidence" as const,
  parser_owner: "maintainer",
  reviewed_by: "maintainer",
  reviewed_at: "2026-08-17",
  review_due_at: "2099-12-31",
  request_interval_ms: 1_000,
  max_attempts: 1,
  enabled: true,
};

test("approved and current source may publish", () => {
  const manifest = sourceManifestSchema.parse(baseManifest);
  assert.equal(canPublishSource(manifest, new Date("2026-08-17T00:00:00Z")), true);
});

test("unknown source is blocked", () => {
  const manifest = sourceManifestSchema.parse({
    ...baseManifest,
    rights_status: "unknown",
    rights_evidence_ref: null,
    attribution_text: null,
    reviewed_by: null,
  });
  assert.equal(canPublishSource(manifest, new Date("2026-08-17T00:00:00Z")), false);
});

test("mapping bundles reject ambiguous exact source labels", () => {
  const item = {
    entity_type: "commodity" as const,
    canonical_label_en: "Beans",
    canonical_label_si: null,
    canonical_label_ta: null,
    variety: null,
    grade: null,
    source_labels: ["Beans"],
  };
  assert.throws(
    () =>
      mappingBundleSchema.parse({
        schema_version: "1.0.0",
        mapping_version: "fixture-v1",
        source_id: "synthetic_prices",
        reviewed_by: "reviewer",
        reviewed_at: "2026-08-17",
        evidence_ref: "test-fixture://mapping",
        items: [
          { ...item, id: "item_beans" },
          { ...item, id: "item_other_beans" },
        ],
        markets: [],
        units: [],
      }),
    /Duplicate item source labels/u,
  );
});
