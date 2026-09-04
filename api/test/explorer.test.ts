import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { embeddedWarehouse, syncWarehouse } from "@lanka-pricelens/foundry/warehouse";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { groupOf, productDetail, searchProducts } from "../src/explorer.ts";

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

function seed(database: ReturnType<typeof openOperationalDatabase>): void {
  const now = "2026-09-04T01:00:00.000Z";
  database.exec(`
    INSERT INTO source (id, manifest_json, name, owner, landing_url, rights_status, reviewed_at, review_due_at, enabled, state, updated_at)
    VALUES ('harti', '{"attribution_text":"Source: HARTI","expected_cadence":"daily"}', 'HARTI', 'HARTI', 'https://harti.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('keells', '{"adapter":{"kind":"keells_api","settings":{}},"expected_cadence":"daily"}', 'Keells', 'JKH', 'https://keells.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('cargills', '{"adapter":{"kind":"cargills_api","settings":{}},"expected_cadence":"daily"}', 'Cargills', 'Cargills', 'https://cargills.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}');
    INSERT INTO market (id, type, label_en, scope_note) VALUES ('market_dambulla', 'wholesale_market', 'Dambulla', 't'), ('market_pettah', 'wholesale_market', 'Pettah', 't'), ('market_keells_online', 'online_store', 'Keells Online', 't'), ('market_cargills_online', 'online_store', 'Cargills Online', 't');
    INSERT INTO product (id, category, canonical_label_en) VALUES ('product_big_onion', 'vegetable', 'Big Onion'), ('product_egg', 'other', 'Egg');
    INSERT INTO item (id, product_id, entity_type, canonical_label_en, origin) VALUES ('item_big_onion_imported', 'product_big_onion', 'commodity', 'Big Onion', 'Imported'), ('item_big_onion', 'product_big_onion', 'commodity', 'Big Onion', NULL), ('item_egg', 'product_egg', 'commodity', 'Egg', NULL);
    INSERT INTO unit_conversion_rule (id, source_unit, normalized_unit, factor_numerator, factor_denominator, rounding_mode, mapping_version) VALUES ('unit_kg_exact', 'kg', 'kg', 1, 1, 'half_away_from_zero', 'v1');
    INSERT INTO source_item_mapping (source_id, source_label, item_id, mapping_version, reviewed_by, reviewed_at, evidence_ref)
    VALUES ('harti', 'B''Onion Imported', 'item_big_onion_imported', 'v1', 'tests', '2026-09-01', 'docs'), ('keells', 'Big Onions', 'item_big_onion', 'v1', 'tests', '2026-09-01', 'docs'), ('cargills', 'Big Onion', 'item_big_onion', 'v1', 'tests', '2026-09-01', 'docs');
    INSERT INTO source_publication (id, source_id, source_publication_key, title, published_at, observed_from, observed_to, landing_url, download_url, status, first_seen_at, last_seen_at)
    VALUES ('pub_h', 'harti', 'h1', 'Bulletin', '2026-09-03T00:00:00.000Z', '2026-09-03', '2026-09-03', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_k', 'keells', 'k1', 'Snapshot', '2026-09-04T00:00:00.000Z', '2026-09-04', '2026-09-04', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_c', 'cargills', 'c1', 'Snapshot', '2026-09-04T00:00:00.000Z', '2026-09-04', '2026-09-04', 'u', 'u', 'canonicalized', '${now}', '${now}');
    INSERT INTO ingest_run (id, source_id, trigger, status, started_at, heartbeat_at, lease_expires_at) VALUES ('run_1', 'harti', 'manual', 'succeeded', '${now}', '${now}', '${now}');
    INSERT INTO source_artifact (id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status)
    VALUES ('art_h', 'pub_h', 'u', 'u', '${now}', 'application/pdf', 1, 'a', 'canonicalized'), ('art_k', 'pub_k', 'u', 'u', '${now}', 'application/json', 1, 'b', 'canonicalized'), ('art_c', 'pub_c', 'u', 'u', '${now}', 'application/json', 1, 'c', 'canonicalized');
  `);
  const staging = database.prepare(
    `INSERT INTO staging_observation (id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label, source_date, price_type, currency, source_quantity, source_unit, min_value_minor, max_value_minor, status, raw_json)
     VALUES (?, 'run_1', ?, ?, 'x', ?, ?, ?, 'LKR', '1', 'kg', 1, 1, 'canonicalized', '{}')`,
  );
  const insert = database.prepare(
    `INSERT INTO price_observation (id, run_id, staging_id, source_publication_id, source_artifact_id, item_id, market_id, price_type, currency, value_kind,
       min_value_minor, max_value_minor, normalized_min_value_minor, normalized_max_value_minor, source_quantity, source_unit, normalized_quantity, normalized_unit,
       conversion_rule_id, observed_from, observed_to, source_row_ref, confidence, comparability_key, lineage_key, effective_key, parser_version, mapping_version, status, created_at)
     VALUES (?, 'run_1', ?, ?, ?, ?, ?, ?, 'LKR', 'point', ?, ?, ?, ?, '1', 'kg', '1', 'kg', 'unit_kg_exact', ?, ?, 'r', 'high', ?, ?, ?, 'p@1', 'v1', 'active', ?)`,
  );
  let sequence = 0;
  const add = (publication: string, artifact: string, item: string, market: string, priceType: string, day: string, rupees: number) => {
    sequence += 1;
    const minor = rupees * 100;
    staging.run(`stg_${sequence}`, artifact, `row_${sequence}`, market, day, priceType);
    insert.run(`obs_${sequence}`, `stg_${sequence}`, publication, artifact, item, market, priceType, minor, minor, minor, minor, day, day, `cmp_${sequence}`, `lin_${sequence}`, `eff_${sequence}`, `${day}T02:00:00.000Z`);
  };
  add("pub_h", "art_h", "item_big_onion", "market_dambulla", "wholesale_observed", "2026-09-01", 250);
  add("pub_h", "art_h", "item_big_onion", "market_dambulla", "wholesale_observed", "2026-09-03", 275);
  add("pub_h", "art_h", "item_big_onion", "market_pettah", "wholesale_observed", "2026-09-03", 268);
  // Two product labels on the Keells shelf the same day: the store's price is their range.
  add("pub_k", "art_k", "item_big_onion", "market_keells_online", "retail_online_store", "2026-09-04", 370);
  add("pub_k", "art_k", "item_big_onion", "market_keells_online", "retail_online_store", "2026-09-04", 390);
  add("pub_c", "art_c", "item_big_onion", "market_cargills_online", "retail_online_store", "2026-09-04", 400);
  add("pub_h", "art_h", "item_big_onion_imported", "market_dambulla", "wholesale_observed", "2026-09-03", 255);
}

async function warehouseFor(database: ReturnType<typeof openOperationalDatabase>) {
  const client = await embeddedWarehouse();
  await syncWarehouse(database, client);
  return client;
}

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
