import assert from "node:assert/strict";
import test from "node:test";

import { canPublishSource, dishCatalogueSchema, mappingBundleSchema, sourceManifestSchema } from "../src/index.ts";

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

const baseBundle = {
  schema_version: "1.0.0" as const,
  mapping_version: "v1",
  source_id: "synthetic_prices",
  reviewed_by: "maintainer",
  reviewed_at: "2026-08-17",
  evidence_ref: "docs/fixtures.md",
  products: [{ id: "product_egg", category: "other" as const, canonical_label_en: "Egg", canonical_label_si: null, canonical_label_ta: null }],
  markets: [{ id: "market_store", type: "online_store" as const, label_en: "Store", label_si: null, label_ta: null, pcode: null, scope_note: "fixture", source_labels: ["Store"] }],
  units: [],
};
const eggItem = {
  id: "item_egg",
  product_id: "product_egg",
  entity_type: "commodity" as const,
  canonical_label_en: "Egg",
  canonical_label_si: null,
  canonical_label_ta: null,
  variety: null,
  grade: null,
  source_labels: [],
  source_patterns: [{ match: "\\beggs?\\b", exclude: ["mayonnaise"], units: ["piece"], pack: "count" as const }],
};

test("mapping bundles accept pattern-mapped items and reject bad rules", () => {
  const parsed = mappingBundleSchema.parse({ ...baseBundle, items: [eggItem] });
  assert.deepEqual(parsed.items[0]?.source_patterns[0], { match: "\\beggs?\\b", exclude: ["mayonnaise"], units: ["piece"], min_quantity: null, pack: "count" });
  assert.deepEqual(parsed.excluded_patterns, []);
  assert.equal(parsed.products[0]?.comparison, "pooled", "products pool their varieties unless told otherwise");
  assert.throws(() => mappingBundleSchema.parse({ ...baseBundle, items: [{ ...eggItem, source_patterns: [] }] }), /at least one source label or pattern/u);
  assert.throws(() => mappingBundleSchema.parse({ ...baseBundle, items: [{ ...eggItem, source_patterns: [{ match: "(" }] }] }), /Invalid regular expression/u);
  assert.throws(() => mappingBundleSchema.parse({ ...baseBundle, excluded_patterns: ["["], items: [eggItem] }), /Invalid regular expression/u);
});

test("dish catalogue validates ids, enums, and pairings", () => {
  const dish = {
    id: "dish_pol_sambol",
    names: { en: "Coconut sambol", si: "පොල් සම්බෝල", si_latn: "Pol sambol", ta: null, ta_latn: null },
    category: "sambol_and_condiment",
    roles: ["condiment"],
    meal_slots: ["breakfast", "lunch", "dinner"],
    region: "island_wide",
    popularity: 1,
    prep_minutes: 10,
    cook_minutes: 0,
    difficulty: "easy",
    diet: ["vegetarian", "gluten_free"],
    protein_source: ["none"],
    spice: "hot",
    key_ingredients: ["product_coconut", "product_red_onion", "product_dried_chillies", "product_lime"],
    other_ingredients: ["salt"],
    summary: "Grated coconut pounded with chilli, onion, and lime, on the table at almost every meal.",
    occasions: ["everyday"],
    variants: [],
    pairs_with: ["dish_kiribath"],
  };
  const kiribath = { ...dish, id: "dish_kiribath", names: { ...dish.names, en: "Milk rice" }, category: "rice_and_grains", roles: ["staple"], pairs_with: ["dish_pol_sambol"] };
  const parsed = dishCatalogueSchema.parse({ schema_version: "1.0.0", reviewed_by: "owner", reviewed_at: "2026-09-05", dishes: [dish, kiribath] });
  assert.equal(parsed.dishes.length, 2);
  assert.throws(() => dishCatalogueSchema.parse({ schema_version: "1.0.0", reviewed_by: "owner", reviewed_at: "2026-09-05", dishes: [dish] }), /Unknown paired dish/u);
  assert.throws(() => dishCatalogueSchema.parse({ schema_version: "1.0.0", reviewed_by: "owner", reviewed_at: "2026-09-05", dishes: [dish, dish] }), /Duplicate dish IDs/u);
  assert.throws(() => dishCatalogueSchema.parse({ schema_version: "1.0.0", reviewed_by: "owner", reviewed_at: "2026-09-05", dishes: [{ ...dish, pairs_with: [], category: "dessert" }] }));
});
