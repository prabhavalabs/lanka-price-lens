import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { createSourceCatalog } from "@lanka-pricelens/foundry/manifest";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { publicOverview, publicSources } from "../src/public.ts";
import { seed, warehouseFor } from "./helpers/warehouse.ts";

const base = {
  owner: "Test",
  retrieval_method: "scheduled_download",
  expected_cadence: "daily",
  formats: ["pdf"],
  geographic_scope: "selected_wholesale_markets",
  price_types: ["wholesale_observed"],
  rights_evidence_ref: "docs/source-permission.md",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-01-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 3,
  enabled: true,
  retry: { attempts: 1, cooldown_minutes: 0 },
};
const harti = sourceManifestSchema.parse({ ...base, id: "harti", name: "HARTI daily prices", landing_url: "https://harti.example/daily", rights_status: "approved_permission", attribution_text: "Source: HARTI" });
const keells = sourceManifestSchema.parse({ ...base, id: "keells", name: "Keells online", landing_url: "https://keells.example/", rights_status: "approved_permission", attribution_text: "Prices: Keells Super", price_types: ["retail_online_store"], adapter: { kind: "keells_api", settings: {} } });
// Cargills is still under evaluation: its prices must never reach the public site.
const cargills = sourceManifestSchema.parse({ ...base, id: "cargills", name: "Cargills online", landing_url: "https://cargills.example/", rights_status: "internal_evaluation", attribution_text: null, price_types: ["retail_online_store"], adapter: { kind: "cargills_api", settings: {} } });

test("the public overview shows published sources only, one price line per seller group with attribution", async () => {
  const database = openOperationalDatabase(":memory:");
  seed(database);
  const client = await warehouseFor(database);
  try {
    const overview = await publicOverview(client, [harti, keells], new Date("2026-09-05T00:00:00Z"));
    assert.deepEqual(overview.sources.map((source) => [source.id, source.kind, source.attribution]), [["harti", "official", "Source: HARTI"], ["keells", "supermarket", "Prices: Keells Super"]]);
    const onion = overview.products.find((product) => product.id === "product_big_onion");
    assert.ok(onion);
    assert.deepEqual(onion.prices.map((price) => [price.group, price.sellers, price.low, price.high, price.unit]), [
      ["supermarket", 1, 370, 390, "kg"],
      ["wholesale", 2, 255, 275, "kg"],
    ], "Cargills is left out; Keells' two shelf labels make its range");
    assert.equal(overview.as_of, "2026-09-04");
    assert.ok(!overview.products.some((product) => product.id === "product_egg"), "a product with no published price has no card");
    assert.deepEqual(publicSources([cargills]).map((source) => source.kind), ["supermarket"]);
  } finally {
    await client.close();
    database.close();
  }
});

test("public routes need no sign-in, are cacheable, filter to published sources, and answer 503 without a warehouse", async () => {
  const database = openOperationalDatabase(":memory:");
  seed(database);
  const client = await warehouseFor(database);
  try {
    const catalog = createSourceCatalog([{ manifest: harti }, { manifest: keells }, { manifest: cargills }]);
    const app = createApp(database, harti, undefined, { catalog, warehouse: async () => client });
    const overview = await app.request("http://localhost/v1/public/overview");
    assert.equal(overview.status, 200);
    assert.equal(overview.headers.get("access-control-allow-origin"), "*");
    assert.match(overview.headers.get("cache-control") ?? "", /public, max-age=300/u);
    const body = (await overview.json()) as { payload: { products: Array<{ id: string; prices: Array<{ group: string; sellers: number }> }>; sources: Array<{ id: string }> } };
    assert.deepEqual(body.payload.sources.map((source) => source.id), ["harti", "keells"]);
    assert.deepEqual(body.payload.products[0]?.prices.map((price) => [price.group, price.sellers]), [["supermarket", 1], ["wholesale", 2]]);

    const detail = await app.request("http://localhost/v1/public/products/product_big_onion?days=30");
    assert.equal(detail.status, 200);
    const payload = ((await detail.json()) as { payload: { latest: Array<{ market_label: string }>; series: Array<{ market_label: string }> } }).payload;
    assert.deepEqual(payload.latest.map((row) => row.market_label).sort(), ["Dambulla", "Keells Online", "Pettah"], "Cargills' shelf price is not published");
    assert.ok(!payload.series.some((series) => series.market_label === "Cargills Online"));

    assert.equal((await app.request("http://localhost/v1/public/products/product_missing")).status, 404);
    assert.equal((await app.request("http://localhost/v1/public/products/product_big_onion?days=12")).status, 400);
    const search = await app.request("http://localhost/v1/public/search?q=onion");
    assert.equal(((await search.json()) as { payload: Array<{ id: string }> }).payload[0]?.id, "product_big_onion");
    assert.deepEqual(((await (await app.request("http://localhost/v1/public/search?q=o")).json()) as { payload: unknown[] }).payload, [], "one letter is not a search");

    const dark = createApp(database, harti, undefined, { catalog });
    assert.equal((await dark.request("http://localhost/v1/public/overview")).status, 503);
  } finally {
    await client.close();
    database.close();
  }
});
