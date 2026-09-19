import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { filesystemArchiveStorage } from "@lanka-pricelens/foundry/archive-storage";
import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { embeddedWarehouse, syncWarehouse } from "@lanka-pricelens/foundry/warehouse";
import { mappingBundleSchema, sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { parseOfferQuery, productOffers, type OffersPage } from "../src/offers.ts";

const today = new Date().toISOString().slice(0, 10);

const manifest = sourceManifestSchema.parse({
  id: "keells_test",
  name: "Keells test",
  owner: "Test",
  landing_url: "https://www.keellssuper.com/",
  retrieval_method: "api_snapshot",
  expected_cadence: "daily",
  formats: ["json"],
  geographic_scope: "online_store_national",
  price_types: ["retail_online_store"],
  rights_status: "approved_permission",
  rights_evidence_ref: "docs/retail-capture.md",
  attribution_text: "Test attribution",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-09-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 3,
  enabled: true,
  adapter: { kind: "keells_api", settings: { minimumRecords: 10, maxAttempts: 1, maxConsecutiveFailures: 2, includeUnavailable: true, requestTimeoutMs: 5000 } },
});

const bundle = mappingBundleSchema.parse({
  schema_version: "1.0.0",
  mapping_version: "keells-test.1",
  source_id: "keells_test",
  reviewed_by: "tests",
  reviewed_at: "2026-09-01",
  evidence_ref: "docs/retail-capture.md",
  products: [{ id: "product_carrot", category: "vegetable", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null }],
  items: [
    { id: "item_carrot", product_id: "product_carrot", entity_type: "commodity", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_labels: ["Carrot"], expected_market_labels: ["Keells Online"] },
  ],
  markets: [{ id: "market_keells_online", type: "online_store", label_en: "Keells Online", label_si: null, label_ta: null, pcode: null, scope_note: "test", source_labels: ["Keells Online"] }],
  units: [{ id: "unit_kg_exact", source_unit: "kg", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" }],
  completeness: { minimum_item_coverage: 0.5, minimum_market_coverage: 1, minimum_cell_coverage: 0.5, minimum_mapping_coverage: 0.05, minimum_score: 0.1 },
});

const record = (index: number, label: string, price: number, raw: Record<string, unknown> = {}) => ({
  rowRef: `row-${index}`, itemLabel: label, marketLabel: "Keells Online", date: today, sourceQuantity: "1", sourceUnit: "kg", minValueMinor: price, maxValueMinor: price, raw,
});

const snapshot = {
  schema_version: "1.0.0",
  source_id: "keells_test",
  capture_date: today,
  captured_at: `${today}T02:24:00.000Z`,
  adapter: "keells_api",
  records: [
    record(0, "Carrot", 36_000, { category: "V/VWM", url: "https://www.keellssuper.com/productDetail?itemcode=row-0&Carrot", image: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic0.jpg", offer: { list_minor: 36_000, offer_minor: 28_800, kind: "discount", audience: "members", label: "Nexus", max_quantity: 3 } }),
    record(1, "Washing Powder 1kg", 90_000, { category: "H/HLA", offer: { list_minor: 100_000, offer_minor: 90_000, kind: "mrp", audience: "everyone" } }),
    record(2, "Dish Soap 500ml", 45_000, { category: "H/HDW", url: "javascript:alert(1)", image: "https://evil.example/soap.jpg", offer: { list_minor: 60_000, offer_minor: 45_000, kind: "promo_price", audience: "everyone" } }),
    ...Array.from({ length: 10 }, (_, index) => record(index + 3, `Shelf item ${index + 1}`, 10_000 + index * 100, { category: "G/GSN" })),
  ],
};

test("store offers are public: each store on its newest day, deepest cut first, linked to the product when the label maps", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
  const root = mkdtempSync(join(tmpdir(), "lpl-offers-"));
  const client = await embeddedWarehouse();
  try {
    const app = createApp(database, manifest, bundle, { warehouse: async () => client, archiveStorage: filesystemArchiveStorage(join(root, "archive")) });
    const login = await app.request("http://localhost/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const imported = await app.request("http://localhost/v1/admin/sources/keells_test/snapshots", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(snapshot) });
    assert.equal(imported.status, 200, await imported.clone().text());

    const read = async (query = ""): Promise<OffersPage> => {
      const response = await app.request(`http://localhost/v1/public/offers${query}`);
      assert.equal(response.status, 200, await response.clone().text());
      return ((await response.json()) as { payload: OffersPage }).payload;
    };
    const all = await read();
    assert.deepEqual([all.as_of, all.total, all.stores], [today, 3, [{ market_id: "market_keells_online", market: "Keells Online", observed_on: today, offers: 3 }]]);
    assert.deepEqual(all.items.map((item) => [item.label, item.pct, item.audience]), [["Dish Soap 500ml", -25, "everyone"], ["Carrot", -20, "members"], ["Washing Powder 1kg", -10, "everyone"]]);
    const carrot = all.items[1]!;
    assert.deepEqual([carrot.price, carrot.list, carrot.offer, carrot.offer_label, carrot.max_quantity, carrot.pack], [360, 360, 288, "Nexus", 3, "1 kg"], "a members' price leaves the shelf price alone");
    assert.deepEqual(carrot.product, { id: "product_carrot", label: "Carrot", unit: "kg", list: 360, offer: 288 });
    assert.equal(all.items[0]!.product, null, "a shelf item outside the catalogue keeps the store's label only");

    assert.deepEqual((await read("?audience=everyone")).items.map((item) => item.label), ["Dish Soap 500ml", "Washing Powder 1kg"]);
    assert.deepEqual((await read("?catalogue=1")).items.map((item) => item.label), ["Carrot"]);
    assert.deepEqual((await read("?q=soap")).items.map((item) => item.label), ["Dish Soap 500ml"]);
    assert.deepEqual((await read("?q=100%25")).total, 0, "a wildcard in the search is matched literally");
    assert.equal((await read("?market=market_nowhere")).total, 0);
    const paged = await read("?pageSize=2&page=2");
    assert.deepEqual([paged.page, paged.page_size, paged.items.map((item) => item.label)], [2, 2, ["Washing Powder 1kg"]]);
    assert.deepEqual(parseOfferQuery({ page: "-4", pageSize: "100000", audience: "staff", market: "Robert'); DROP" }), { market: undefined, search: undefined, audience: undefined, catalogue: undefined, page: 1, pageSize: 200 });

    // Every deal leads to its shelf, and shows the store's own picture once a copy is kept; until then a tracked product borrows the site's photo.
    assert.equal(carrot.url, "https://www.keellssuper.com/productDetail?itemcode=row-0&Carrot");
    assert.deepEqual([carrot.image, carrot.image_origin], ["/images/products/carrot.jpg", "generated"]);
    assert.deepEqual([all.items[0]!.url, all.items[0]!.image, all.items[0]!.image_origin], [null, null, null], "an address that is not a store's page or picture never reaches a card");
    assert.deepEqual(database.prepare("SELECT row_ref, image_status, image_source_url FROM store_product ORDER BY row_ref").all(), [
      { row_ref: "row-0", image_status: "pending", image_source_url: "https://essstr.blob.core.windows.net/essimg/350x/Small/Pic0.jpg" },
      { row_ref: "row-1", image_status: "none", image_source_url: null },
      { row_ref: "row-2", image_status: "none", image_source_url: null },
    ], "the items on offer are kept with the original address of their picture, waiting to be fetched");
    const stored = `keells_test/ab/${"ab".padEnd(64, "1")}.jpg`;
    database.prepare("UPDATE store_product SET image_status = 'stored', image_path = ? WHERE row_ref = 'row-0'").run(stored);
    await syncWarehouse(database, client);
    const pictured = (await read("?catalogue=1")).items[0]!;
    assert.deepEqual([pictured.image, pictured.image_origin], [`/store-images/${stored}`, "store"], "the store's own picture takes over; the generated photo itself is untouched");

    const page = await app.request("http://localhost/v1/public/products/product_carrot");
    assert.equal(page.status, 200, await page.clone().text());
    const detail = ((await page.json()) as { payload: { latest: Array<{ mid: number }>; offers: Array<{ offer: number; list: number; audience: string }> } }).payload;
    assert.deepEqual(detail.offers.map((entry) => [entry.offer, entry.list, entry.audience]), [[288, 360, "members"]], "the product page carries the store's offer");
    assert.equal(detail.latest[0]?.mid, 360, "and the seller's price stays what every shopper pays");

    const forCarrot = await productOffers(client, [manifest], ["product_carrot", "product_missing"]);
    assert.deepEqual([...forCarrot.keys()], ["product_carrot"]);
    assert.equal(forCarrot.get("product_carrot")?.[0]?.offer, 288);
    // Offers older than three days are not shown as today's.
    assert.equal((await productOffers(client, [manifest], ["product_carrot"], new Date(Date.now() + 5 * 86_400_000))).size, 0);
  } finally {
    await client.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
