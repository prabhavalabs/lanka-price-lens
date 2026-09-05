import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { groupOf, productDetail, searchProducts } from "../src/explorer.ts";
import { seed, warehouseFor } from "./helpers/warehouse.ts";

const manifest = sourceManifestSchema.parse({
  id: "harti",
  name: "HARTI",
  owner: "HARTI",
  landing_url: "https://harti.example/daily",
  retrieval_method: "scheduled_download",
  expected_cadence: "daily",
  formats: ["pdf"],
  geographic_scope: "selected_wholesale_markets",
  price_types: ["wholesale_observed"],
  rights_status: "approved_permission",
  rights_evidence_ref: "docs/source-permission.md",
  attribution_text: "Source: HARTI",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-01-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 3,
  enabled: true,
});


test("explorer search finds products by canonical label, variety, and source alias, one row per product", async () => {
  const database = openOperationalDatabase(":memory:");
  seed(database);
  const client = await warehouseFor(database);
  try {
    const onions = await searchProducts(client, "onion");
    assert.deepEqual(onions.map((product) => product.id), ["product_big_onion"], "varieties of one food are one search result");
    const onion = onions[0]!;
    assert.deepEqual([onion.comparison, onion.sellers, onion.last_day], ["pooled", 4, "2026-09-04"], "a seller pricing two varieties is one seller");
    assert.deepEqual(onion.varieties.map((variety) => [variety.id, variety.qualifier, variety.sellers, variety.base]), [["item_big_onion", "Unspecified", 4, true], ["item_big_onion_imported", "Imported", 1, false]]);
    assert.ok(onion.aliases.includes("Big Onions") && onion.aliases.includes("B'Onion Imported"));
    assert.deepEqual((await searchProducts(client, "b'onion")).map((product) => product.id), ["product_big_onion"], "an alias of a variety finds the product");
    assert.deepEqual((await searchProducts(client, "imported onion")).map((product) => product.id), ["product_big_onion"]);
    assert.deepEqual((await searchProducts(client, "egg")).map((product) => [product.id, product.sellers]), [["product_egg", 0]], "products without prices still appear");
    assert.deepEqual((await searchProducts(client, "", 1)).map((product) => product.id), ["product_big_onion"], "products with more sellers rank first");
    assert.equal(groupOf("retail_observed"), "retail_market");
  } finally {
    await client.close();
    database.close();
  }
});

test("explorer product view pools varieties per seller and narrows to one on request", async () => {
  const database = openOperationalDatabase(":memory:");
  seed(database);
  const client = await warehouseFor(database);
  try {
    const pooled = await productDetail(client, "product_big_onion", { kind: "preset", days: 30 }, {}, new Date("2026-09-05T00:00:00Z"));
    assert.ok(pooled);
    assert.deepEqual(pooled.selected, ["item_big_onion", "item_big_onion_imported"], "a pooled product opens on every variety");
    assert.deepEqual(pooled.bounds, { first: "2026-09-01", last: "2026-09-04" });
    assert.deepEqual([pooled.range.from, pooled.range.to, pooled.range.days], ["2026-08-06", "2026-09-04", 30]);
    assert.equal(pooled.latest.length, 4, "one row per seller, not per variety");
    const dambulla = pooled.latest.find((entry) => entry.market_id === "market_dambulla")!;
    assert.deepEqual([dambulla.low, dambulla.high, dambulla.mid, dambulla.products, dambulla.varieties], [255, 275, 265, 2, ["Imported", "Unspecified"]], "the seller's varieties pool into a range");
    const wholesale = pooled.summary.find((entry) => entry.group === "wholesale")!;
    assert.deepEqual([wholesale.sellers, wholesale.average, wholesale.lowest?.market_id, wholesale.highest?.market_id, wholesale.unit], [2, 266.5, "market_dambulla", "market_pettah", "kg"]);
    const supermarket = pooled.summary.find((entry) => entry.group === "supermarket")!;
    assert.deepEqual([supermarket.sellers, supermarket.average, supermarket.lowest?.market_label], [2, 390, "Keells Online"]);
    const keells = pooled.latest.find((entry) => entry.market_id === "market_keells_online")!;
    assert.deepEqual([keells.low, keells.high, keells.mid, keells.products], [370, 390, 380, 2], "a store's daily price spans every product label of the item");
    assert.equal(pooled.markup_pct, 46.3);
    assert.equal(pooled.series[0]?.group, "wholesale", "wholesale series come first");

    const local = await productDetail(client, "product_big_onion", { kind: "preset", days: 30 }, { varieties: ["item_big_onion", "item_missing"] }, new Date("2026-09-05T00:00:00Z"));
    assert.deepEqual(local?.selected, ["item_big_onion"], "unknown varieties are ignored");
    const narrowed = local!.latest.find((entry) => entry.market_id === "market_dambulla")!;
    assert.deepEqual([narrowed.mid, narrowed.products, narrowed.varieties], [275, 1, ["Unspecified"]]);
    assert.equal(local!.summary.find((entry) => entry.group === "wholesale")?.average, 271.5);
    const series = local!.series.find((entry) => entry.market_id === "market_dambulla")!;
    assert.deepEqual([series.days, series.first.mid, series.last.mid, series.change_pct], [2, 250, 275, 10]);

    const everything = await productDetail(client, "product_big_onion", { kind: "custom", from: "2026-09-04", to: "2026-09-04" }, { varieties: "all" });
    assert.deepEqual(everything?.series.map((entry) => entry.market_label).sort(), ["Cargills Online", "Keells Online"]);

    await client.query("UPDATE product SET comparison = 'by_variety' WHERE id = 'product_big_onion'");
    const byVariety = await productDetail(client, "product_big_onion", { kind: "preset", days: 30 }, {}, new Date("2026-09-05T00:00:00Z"));
    assert.deepEqual([byVariety?.product.comparison, byVariety?.selected], ["by_variety", ["item_big_onion"]], "a by-variety product opens on its base variety");
    assert.equal(await productDetail(client, "product_missing", { kind: "preset", days: 30 }), null);
  } finally {
    await client.close();
    database.close();
  }
});

test("explorer routes need a signed-in owner and answer 503 without a warehouse", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`;
  seedAdminUser(database, "owner@example.com", passwordHash);
  seed(database);
  const client = await warehouseFor(database);
  try {
    const withWarehouse = createApp(database, manifest, undefined, { warehouse: async () => client });
    assert.equal((await withWarehouse.request("http://localhost/v1/admin/explorer/search?q=onion")).status, 401);
    const login = await withWarehouse.request("http://localhost/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const search = await withWarehouse.request("http://localhost/v1/admin/explorer/search?q=onion", { headers: { cookie } });
    assert.equal(search.status, 200);
    assert.equal(((await search.json()) as { payload: Array<{ id: string }> }).payload[0]?.id, "product_big_onion");
    const product = await withWarehouse.request("http://localhost/v1/admin/explorer/products/product_big_onion?days=30", { headers: { cookie } });
    assert.equal(product.status, 200);
    assert.equal(((await product.json()) as { payload: { latest: unknown[] } }).payload.latest.length, 4);
    const imported = await withWarehouse.request("http://localhost/v1/admin/explorer/products/product_big_onion?days=30&varieties=item_big_onion_imported", { headers: { cookie } });
    assert.deepEqual(((await imported.json()) as { payload: { selected: string[]; latest: unknown[] } }).payload.selected, ["item_big_onion_imported"]);
    assert.equal((await withWarehouse.request("http://localhost/v1/admin/explorer/products/product_big_onion?days=7", { headers: { cookie } })).status, 400);
    assert.equal((await withWarehouse.request("http://localhost/v1/admin/explorer/products/nope?days=30", { headers: { cookie } })).status, 404);

    const withoutWarehouse = createApp(database, manifest);
    const denied = await withoutWarehouse.request("http://localhost/v1/admin/explorer/search?q=onion", { headers: { cookie } });
    assert.equal(denied.status, 503);
    const failing = createApp(database, manifest, undefined, { warehouse: async () => { throw new Error("connection refused"); } });
    assert.equal((await failing.request("http://localhost/v1/admin/explorer/search?q=onion", { headers: { cookie } })).status, 503);
  } finally {
    await client.close();
    database.close();
  }
});
