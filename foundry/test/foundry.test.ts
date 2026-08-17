import assert from "node:assert/strict";
import test from "node:test";

import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { openOperationalDatabase, startRun, syncSource } from "../src/db.ts";
import { discoverHartiDaily, parseHartiWholesale } from "../src/harti.ts";
import { runIngestion } from "../src/pipeline.ts";
import type { TextItem } from "../src/pdf.ts";

const manifest = sourceManifestSchema.parse({
  id: "test_source",
  name: "Test source",
  owner: "Test owner",
  landing_url: "https://example.com/prices",
  retrieval_method: "scheduled_download",
  expected_cadence: "business_daily",
  formats: ["pdf"],
  geographic_scope: "test",
  price_types: ["wholesale_observed"],
  rights_status: "unknown",
  rights_evidence_ref: null,
  attribution_text: null,
  retention_policy: "metadata_and_checksum_only",
  parser_owner: null,
  reviewed_by: null,
  reviewed_at: "2026-08-17",
  review_due_at: "2026-11-17",
  request_interval_ms: 1000,
  max_attempts: 1,
  enabled: false,
});

test("rights gate blocks all network activity", async () => {
  const database = openOperationalDatabase(":memory:");
  let requests = 0;
  const result = await runIngestion(database, manifest, {
    trigger: "scheduled",
    request: async () => {
      requests += 1;
      return new Response();
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(requests, 0);
  database.close();
});

test("run lease prevents overlapping source runs", () => {
  const database = openOperationalDatabase(":memory:");
  syncSource(database, manifest);
  assert.equal(startRun(database, { sourceId: manifest.id, trigger: "test" }).started, true);
  assert.equal(startRun(database, { sourceId: manifest.id, trigger: "test" }).started, false);
  database.close();
});

test("HARTI discovery and coordinate parser produce dated price ranges", () => {
  const publications = discoverHartiDaily(
    '<a href="assets/pdf/food_price/daily/eng/2026/August/daily_16-08-2026.pdf">PDF</a><a href="https://evil.example/assets/pdf/food_price/daily/eng/2026/August/daily_15-08-2026.pdf">bad</a>',
    "https://example.com/daily-price.php",
  );
  assert.equal(publications[0]?.date, "2026-08-16");
  assert.equal(publications.length, 1);

  const markets = ["Peliyagoda", "Kandy", "Dambulla", "Meegoda", "Norochchole", "Thambuththegama", "Keppetipola", "Nuwaraeliya", "Bandarawela", "Veyangoda"];
  const items: TextItem[] = [item(0, "Variety", 50, 665)];
  markets.forEach((market, index) => {
    const x = 120 + index * 48;
    items.push(item(items.length, market, x, 665), item(items.length + 1, "2026.08.16", x, 677));
  });
  for (let row = 0; row < 2; row += 1) {
    const y = 630 - row * 12;
    items.push(item(items.length, row ? "Carrot" : "Beans", 35, y));
    markets.forEach((_, index) => {
      const x = 116 + index * 48;
      items.push(item(items.length, String(100 + row), x, y), item(items.length + 1, String(120 + row), x + 22, y));
    });
  }
  const observations = parseHartiWholesale(items);
  assert.equal(observations.length, 20);
  assert.deepEqual(
    { date: observations[0]?.date, minimum: observations[0]?.minValueMinor, maximum: observations[0]?.maxValueMinor },
    { date: "2026-08-16", minimum: 10_000, maximum: 12_000 },
  );
});

function item(index: number, text: string, x: number, y: number): TextItem {
  return { page: 1, index, text, x, y, width: 10, height: 8 };
}
