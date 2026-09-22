import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { openOperationalDatabase, type OperationalDatabase } from "../src/db.ts";
import { computeDeals, currentDealsDay, dealsCommand, dealsEngine, isCurrentDealsDay, latestDealsDay, loadEssentials, readDealsDay, saveDealsDay, shiftDay, type DealsDay, type DealsRow } from "../src/deals/index.ts";
import { colomboDay } from "../src/retail/capture.ts";
import { embeddedWarehouse, syncWarehouse, type WarehouseClient } from "../src/warehouse/index.ts";

const day = "2026-09-14";
/** Mid-morning on the day in Colombo; the UTC clock is still on the same date, the test must not depend on the machine's zone. */
const at = new Date("2026-09-14T09:00:00+05:30");
const ago = (days: number): string => shiftDay(day, -days);

const storeLabels: Record<string, string> = {
  market_cargills_online: "Cargills Online",
  market_glomark_online: "Glomark Online",
  market_keells_online: "Keells Online",
  market_spar_online: "SPAR Online",
};

/** One day of one series as the warehouse would answer it: prices in rupees here, minor units (text) in the row. */
function row(product: string, market: string, observedOn: string, rupees: number, extra: { item?: string; unit?: string } = {}): DealsRow {
  const label = product.replace(/^product_/u, "").split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
  return {
    product_id: product,
    label,
    item_id: extra.item ?? product.replace(/^product_/u, "item_"),
    market_id: market,
    market: storeLabels[market] ?? market,
    unit: extra.unit ?? "kg",
    observed_on: observedOn,
    mid_minor: String(Math.round(rupees * 100)),
  };
}

type FakeWarehouse = WarehouseClient & { calls: Array<{ sql: string; params: unknown[] }>; closed: number };

/** A warehouse that answers every query with the same canned rows and remembers what it was asked. */
function fakeWarehouse(rows: DealsRow[]): FakeWarehouse {
  const client: FakeWarehouse = {
    kind: "pglite",
    calls: [],
    closed: 0,
    query: async <T,>(sql: string, params: unknown[] = []) => {
      client.calls.push({ sql, params });
      return rows as T[];
    },
    transaction: (work) => work(client),
    close: async () => {
      client.closed += 1;
    },
  };
  return client;
}

async function compute(rows: DealsRow[], essentials: string[] = []): Promise<DealsDay> {
  return computeDeals(fakeWarehouse(rows), { day: at, essentials });
}

test("the window query covers the day and the fortnight before it over the online stores only", async () => {
  const client = fakeWarehouse([]);
  const result = await computeDeals(client, { day: at, essentials: ["product_potato"] });
  assert.equal(result.day, day);
  assert.equal(client.calls.length, 2, "the price window, then the stores' own offers");
  assert.match(client.calls[1]?.sql ?? "", /FROM store_offer offer/u);
  assert.match(client.calls[1]?.sql ?? "", /\$1::date - 1 AND \$1::date/u);
  assert.deepEqual(client.calls[1]?.params, [day]);
  assert.deepEqual(result.store_offers, []);
  const call = client.calls[0];
  assert.deepEqual(call?.params, [day]);
  assert.match(call?.sql ?? "", /market\.type = 'online_store'/u);
  assert.match(call?.sql ?? "", /price_type = 'retail_online_store'/u);
  assert.match(call?.sql ?? "", /\$1::date - 14 AND \$1::date/u);
  assert.deepEqual(result.stats, { series: 0, fresh: 0, considered: 0 });
  assert.deepEqual({ stores: result.stores, deals: result.deals, cheapest: result.cheapest, movers_up: result.movers_up, essentials: result.essentials }, { stores: [], deals: [], cheapest: [], movers_up: [], essentials: [] });
  assert.match(result.computed_at, /^\d{4}-\d{2}-\d{2}T/u);

  const today = await computeDeals(fakeWarehouse([]), { essentials: [] });
  assert.equal(today.day, colomboDay(new Date()), "the day defaults to today in Colombo");
});

test("a stale series never makes a deal; the day before still counts", async () => {
  const result = await compute([
    row("product_potato", "market_keells_online", ago(5), 300),
    row("product_potato", "market_keells_online", ago(2), 200),
    row("product_potato", "market_cargills_online", ago(2), 300),
    row("product_potato", "market_cargills_online", ago(1), 200),
  ]);
  assert.equal(result.deals.length, 1, "only the series last seen yesterday counts");
  assert.equal(result.deals[0]?.market_id, "market_cargills_online");
  assert.deepEqual(result.stats, { series: 2, fresh: 1, considered: 1 });
  assert.deepEqual(result.stores, [
    { market_id: "market_cargills_online", label: "Cargills Online", series: 1, deals: 1 },
    { market_id: "market_keells_online", label: "Keells Online", series: 1, deals: 0 },
  ]);
});

test("a drop of 10 % or more against the previous day counts when that day is within three days", async () => {
  const result = await compute([
    row("product_potato", "market_keells_online", ago(1), 300),
    row("product_potato", "market_keells_online", day, 264),
    row("product_carrot", "market_keells_online", ago(3), 300),
    row("product_carrot", "market_keells_online", day, 270),
    row("product_beans", "market_keells_online", ago(4), 300),
    row("product_beans", "market_keells_online", day, 200),
    row("product_tomato", "market_keells_online", ago(1), 300),
    row("product_tomato", "market_keells_online", day, 275),
  ]);
  assert.deepEqual(result.deals, [
    { product_id: "product_potato", label: "Potato", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 26400, was_minor: 30000, was_on: ago(1), pct: -12, kind: "drop", baseline: "yesterday", url: "/p/product_potato" },
    { product_id: "product_carrot", label: "Carrot", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 27000, was_minor: 30000, was_on: ago(3), pct: -10, kind: "drop", baseline: "yesterday", url: "/p/product_carrot" },
  ]);
  assert.deepEqual(result.stats, { series: 4, fresh: 4, considered: 3 }, "beans has no usable baseline: its previous day is four days back and it has one prior day");
  assert.deepEqual(result.movers_up, []);
});

test("a drop of 15 % or more against the fortnight median needs three prior days inside the window", async () => {
  const result = await compute([
    row("product_beans", "market_keells_online", ago(15), 100),
    row("product_beans", "market_keells_online", ago(10), 500),
    row("product_beans", "market_keells_online", ago(7), 500),
    row("product_beans", "market_keells_online", ago(3), 360),
    row("product_beans", "market_keells_online", day, 410),
    row("product_carrot", "market_keells_online", ago(10), 500),
    row("product_carrot", "market_keells_online", ago(7), 500),
    row("product_carrot", "market_keells_online", day, 400),
  ]);
  assert.deepEqual(result.deals, [
    { product_id: "product_beans", label: "Beans", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 41000, was_minor: 50000, was_on: ago(10), pct: -18, kind: "drop", baseline: "median14", url: "/p/product_beans" },
  ], "the day outside the window does not pull the median down, and the median is dated from the oldest day it covers");
  assert.deepEqual(result.stats, { series: 2, fresh: 2, considered: 1 }, "two prior days are not enough for a median, and a previous day a week back is too far for the yesterday rule");
});

test("the larger fall is reported, and a fall of 20 % or more is an offer", async () => {
  const result = await compute([
    row("product_tomato", "market_keells_online", ago(10), 400),
    row("product_tomato", "market_keells_online", ago(5), 400),
    row("product_tomato", "market_keells_online", ago(2), 400),
    row("product_tomato", "market_keells_online", ago(1), 500),
    row("product_tomato", "market_keells_online", day, 300),
    row("product_big_onion", "market_keells_online", ago(10), 400),
    row("product_big_onion", "market_keells_online", ago(5), 400),
    row("product_big_onion", "market_keells_online", ago(2), 400),
    row("product_big_onion", "market_keells_online", ago(1), 320),
    row("product_big_onion", "market_keells_online", day, 300),
    row("product_egg", "market_keells_online", ago(1), 100, { unit: "each" }),
    row("product_egg", "market_keells_online", day, 80, { unit: "each" }),
    row("product_salt", "market_keells_online", ago(1), 100),
    row("product_salt", "market_keells_online", day, 81),
  ]);
  assert.deepEqual(
    result.deals.map((deal) => [deal.product_id, deal.kind, deal.baseline, deal.pct, deal.was_minor]),
    [
      ["product_tomato", "offer", "yesterday", -40, 50000],
      ["product_big_onion", "offer", "median14", -25, 40000],
      ["product_egg", "offer", "yesterday", -20, 10000],
      ["product_salt", "drop", "yesterday", -19, 10000],
    ],
    "tomato fell 40 % on the day and 25 % against its median: the day wins; big onion only qualifies against its median; 20 % is an offer and 19 % a drop",
  );
});

test("the cheapest store is a pick of its own when it undercuts the next cheapest by 15 % or more in the same unit", async () => {
  const result = await compute([
    row("product_egg", "market_keells_online", day, 30, { unit: "each" }),
    row("product_egg", "market_glomark_online", ago(1), 36, { unit: "each" }),
    row("product_egg", "market_cargills_online", day, 40, { unit: "each" }),
    row("product_egg", "market_spar_online", ago(3), 20, { unit: "each" }),
    row("product_sugar_white", "market_keells_online", day, 100),
    row("product_sugar_white", "market_cargills_online", day, 90),
    row("product_salt", "market_keells_online", day, 100),
    row("product_salt", "market_cargills_online", day, 50, { unit: "pack" }),
  ]);
  assert.deepEqual(result.cheapest, [
    { product_id: "product_egg", label: "Egg", unit: "each", market_id: "market_keells_online", market: "Keells Online", now_minor: 3000, was_minor: 3600, was_on: ago(1), pct: -16.7, kind: "cheapest", baseline: "other_stores", url: "/p/product_egg" },
  ], "the stale SPAR price is ignored, sugar is only 10 % apart, and salt is priced in different units");
  assert.deepEqual(result.deals, [], "a cheapest-store pick never enters the drops list");
  assert.deepEqual(result.stats, { series: 8, fresh: 7, considered: 0 });
  assert.equal(result.stores.find((store) => store.market_id === "market_keells_online")?.deals, 1, "a store's count covers its cheapest-store picks too");
});

test("one deal per product, best first, at most twelve deals, eight cheapest-store picks, and five movers", async () => {
  const rows: DealsRow[] = [];
  for (let index = 1; index <= 14; index += 1) {
    const product = `product_p${String(index).padStart(2, "0")}`;
    rows.push(row(product, "market_keells_online", ago(1), 1000), row(product, "market_keells_online", day, 1000 - (10 + index) * 10));
  }
  rows.push(row("product_p01", "market_cargills_online", ago(1), 1000), row("product_p01", "market_cargills_online", day, 700));
  for (let index = 0; index <= 7; index += 1) {
    const product = `product_m${String(index).padStart(2, "0")}`;
    rows.push(row(product, "market_keells_online", ago(1), 1000), row(product, "market_keells_online", day, 1000 + (14 + index) * 10));
  }
  for (let index = 1; index <= 10; index += 1) {
    const product = `product_c${String(index).padStart(2, "0")}`;
    rows.push(row(product, "market_keells_online", day, 1000), row(product, "market_cargills_online", day, 1000 - (20 + index) * 10));
  }
  const result = await compute(rows);

  assert.equal(result.deals.length, 12);
  assert.deepEqual(result.deals[0], { product_id: "product_p01", label: "P01", unit: "kg", market_id: "market_cargills_online", market: "Cargills Online", now_minor: 70000, was_minor: 100000, was_on: ago(1), pct: -30, kind: "offer", baseline: "yesterday", url: "/p/product_p01" }, "the deeper cut at Cargills is the one kept for p01");
  assert.equal(new Set(result.deals.map((deal) => deal.product_id)).size, 12, "no product appears twice");
  assert.deepEqual(result.deals.map((deal) => deal.pct), [-30, -24, -23, -22, -21, -20, -19, -18, -17, -16, -15, -14], "sorted by the size of the fall; the two smallest falls are cut");

  assert.deepEqual(result.movers_up.map((deal) => [deal.product_id, deal.pct, deal.kind, deal.baseline]), [
    ["product_m07", 21, "drop", "yesterday"],
    ["product_m06", 20, "drop", "yesterday"],
    ["product_m05", 19, "drop", "yesterday"],
    ["product_m04", 18, "drop", "yesterday"],
    ["product_m03", 17, "drop", "yesterday"],
  ], "the five largest rises of 15 % or more; the 14 % rise never qualifies");

  assert.equal(result.cheapest.length, 8);
  assert.deepEqual(result.cheapest.map((deal) => [deal.product_id, deal.market_id, deal.kind, deal.pct]), [
    ["product_c10", "market_cargills_online", "cheapest", -30],
    ["product_c09", "market_cargills_online", "cheapest", -29],
    ["product_c08", "market_cargills_online", "cheapest", -28],
    ["product_c07", "market_cargills_online", "cheapest", -27],
    ["product_c06", "market_cargills_online", "cheapest", -26],
    ["product_c05", "market_cargills_online", "cheapest", -25],
    ["product_c04", "market_cargills_online", "cheapest", -24],
    ["product_c03", "market_cargills_online", "cheapest", -23],
  ], "the largest gaps first; the two smallest gaps are cut");
  assert.ok(result.deals.every((deal) => deal.kind !== "cheapest"), "the drops list never carries a cheapest-store pick");
  assert.equal(result.stores.find((store) => store.market_id === "market_keells_online")?.deals, 11);
  assert.equal(result.stores.find((store) => store.market_id === "market_cargills_online")?.deals, 9, "one drop and eight cheapest-store picks");
});

test("essentials report the cheapest store, the change against yesterday, and the trend against the fortnight", async () => {
  const rows = [
    row("product_rice_nadu", "market_keells_online", ago(10), 300),
    row("product_rice_nadu", "market_keells_online", ago(6), 300),
    row("product_rice_nadu", "market_keells_online", ago(1), 250),
    row("product_rice_nadu", "market_keells_online", day, 240),
    row("product_rice_nadu", "market_cargills_online", ago(1), 230),
    row("product_rice_nadu", "market_cargills_online", day, 260),
    row("product_red_dhal", "market_keells_online", day, 500),
    row("product_salt", "market_keells_online", ago(3), 100),
    row("product_big_onion", "market_keells_online", ago(9), 100),
    row("product_big_onion", "market_keells_online", ago(6), 100),
    row("product_big_onion", "market_keells_online", ago(3), 100),
    row("product_big_onion", "market_keells_online", ago(1), 100),
    row("product_big_onion", "market_keells_online", day, 110),
    row("product_tomato", "market_keells_online", ago(9), 100),
    row("product_tomato", "market_keells_online", ago(6), 100),
    row("product_tomato", "market_keells_online", ago(3), 100),
    row("product_tomato", "market_keells_online", day, 103),
    row("product_egg", "market_keells_online", day, 30, { unit: "each" }),
    row("product_egg", "market_cargills_online", day, 32, { unit: "each" }),
    row("product_egg", "market_glomark_online", day, 20, { unit: "kg", item: "item_egg_kg" }),
  ];
  const result = await compute(rows, ["product_tea", "product_rice_nadu", "product_egg", "product_red_dhal", "product_salt", "product_big_onion", "product_tomato", "product_rice_nadu"]);
  assert.deepEqual(result.essentials, [
    { product_id: "product_rice_nadu", label: "Rice Nadu", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 24000 }, change_pct: 4.3, trend: "down" },
    { product_id: "product_egg", label: "Egg", unit: "each", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 3000 }, change_pct: null, trend: "flat" },
    { product_id: "product_red_dhal", label: "Red Dhal", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 50000 }, change_pct: null, trend: "flat" },
    { product_id: "product_big_onion", label: "Big Onion", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 11000 }, change_pct: 10, trend: "up" },
    { product_id: "product_tomato", label: "Tomato", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 10300 }, change_pct: null, trend: "flat" },
  ], "in list order without repeats; tea has no price and salt is stale; egg is watched in the unit two stores use; rice compares 240 with yesterday's cheapest 230 and a median cheapest of 300");
});

test("a computed day round-trips through the operational store and the newest day wins", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    assert.equal(latestDealsDay(database), null);
    assert.equal(readDealsDay(database, day), null);
    const today = await compute([row("product_potato", "market_keells_online", ago(1), 300), row("product_potato", "market_keells_online", day, 264)]);
    const yesterday: DealsDay = { ...today, day: ago(1), computed_at: "2026-09-13T02:00:00.000Z", deals: [] };
    saveDealsDay(database, today);
    saveDealsDay(database, yesterday);
    assert.deepEqual(latestDealsDay(database), today);
    assert.deepEqual(readDealsDay(database, ago(1)), yesterday);
    const recomputed: DealsDay = { ...today, computed_at: "2026-09-14T09:00:00.000Z" };
    saveDealsDay(database, recomputed);
    assert.deepEqual(readDealsDay(database, day), recomputed, "saving the same day again replaces it");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM deal_day").get() as { count: number }).count, 2);
  } finally {
    database.close();
  }
});

test("a day carries the engine that wrote it, and a day an older engine saved reads as one to compute again", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const today = await compute([row("product_potato", "market_keells_online", ago(1), 300), row("product_potato", "market_keells_online", day, 264)]);
    assert.equal(today.engine, dealsEngine, "the engine stamps every day it computes");
    // The shape of a saved day follows the code: a day saved before a field the card or the mail
    // reads was added is still the day's answer for readers, and a recompute for everyone else.
    const { engine: _older, ...stale } = today;
    saveDealsDay(database, stale);
    assert.equal(isCurrentDealsDay(stale), false);
    assert.deepEqual(readDealsDay(database, day), stale, "the saved day is served as it stands");
    assert.deepEqual(latestDealsDay(database), stale);
    assert.equal(currentDealsDay(database, day), null, "a reader that can recompute is told there is no day yet");

    saveDealsDay(database, today);
    assert.equal(isCurrentDealsDay(today), true);
    assert.deepEqual(currentDealsDay(database, day), today);
    assert.equal(currentDealsDay(database, ago(1)), null, "a day that was never computed is still none");
  } finally {
    database.close();
  }
});

test("the essentials list names products the online stores sell, and a bad file is refused with its path", () => {
  const essentials = loadEssentials();
  assert.ok(essentials.length >= 20 && essentials.length <= 30, `about 25 essentials, not ${essentials.length}`);
  assert.equal(new Set(essentials).size, essentials.length);
  const mappings = fileURLToPath(new URL("../../data/mappings/", import.meta.url));
  const sold = new Set<string>();
  for (const file of readdirSync(mappings).filter((name) => name.endsWith("_online_prices.json"))) {
    const bundle = JSON.parse(readFileSync(join(mappings, file), "utf8")) as { products: Array<{ id: string }> };
    for (const product of bundle.products) sold.add(product.id);
  }
  assert.deepEqual(essentials.filter((id) => !sold.has(id)), [], "every essential is a product in at least one store bundle");

  const root = mkdtempSync(join(tmpdir(), "lpl-essentials-"));
  try {
    const malformed = join(root, "essentials.json");
    writeFileSync(malformed, JSON.stringify({ products: ["product_potato"] }));
    assert.throws(() => loadEssentials(malformed), /must be a JSON array of product ids/u);
    writeFileSync(malformed, JSON.stringify(["Potato!"]));
    assert.throws(() => loadEssentials(malformed), /must be a JSON array of product ids/u);
    writeFileSync(malformed, "[]");
    assert.throws(() => loadEssentials(malformed), /names no products/u);
    assert.throws(() => loadEssentials(join(root, "missing.json")), /Cannot read the essentials list at .*missing\.json/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deals compute prints the day as JSON, keeps it with --save, and closes the warehouse", async () => {
  const database = openOperationalDatabase(":memory:");
  const client = fakeWarehouse([row("product_potato", "market_keells_online", ago(1), 300), row("product_potato", "market_keells_online", day, 264)]);
  const printed: string[] = [];
  const log = console.log;
  console.log = (line: string) => {
    printed.push(line);
  };
  try {
    await dealsCommand(["compute", "--day", day, "--save"], { database, warehouse: async () => client });
    assert.equal(printed.length, 1);
    const output = JSON.parse(printed[0] ?? "") as DealsDay;
    assert.equal(output.day, day);
    assert.equal(output.deals[0]?.product_id, "product_potato");
    assert.ok(output.essentials.length === 0 || output.essentials.every((entry) => typeof entry.product_id === "string"));
    assert.equal(latestDealsDay(database)?.day, day, "--save keeps the day");
    assert.equal(client.closed, 1);

    await dealsCommand(["compute", "--day", ago(1)], { database, warehouse: async () => client });
    assert.equal(latestDealsDay(database)?.day, day, "without --save nothing is written");
    assert.equal(client.closed, 2);

    await assert.rejects(dealsCommand(["compute", "--day", "2026-02-30"], { database, warehouse: async () => client }), /--day must be a valid YYYY-MM-DD date/u);
    await assert.rejects(dealsCommand(["frobnicate"], { database, warehouse: async () => client }), /Usage: deals compute/u);
  } finally {
    console.log = log;
    database.close();
  }
});

/** An operational store with two online stores and a wholesale market, synced into an embedded warehouse, so the SQL itself is exercised. */
function seededWarehouse(): { database: OperationalDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "lpl-deals-"));
  const database = openOperationalDatabase(join(root, "operations.sqlite"));
  const now = "2026-09-14T01:00:00.000Z";
  database.exec(`
    INSERT INTO source (id, manifest_json, name, owner, landing_url, rights_status, reviewed_at, review_due_at, enabled, state, updated_at)
    VALUES ('harti', '{"attribution_text":"Source: HARTI"}', 'HARTI', 'HARTI', 'https://harti.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('keells', '{"adapter":{"kind":"keells_api","settings":{}}}', 'Keells', 'JKH', 'https://keells.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('cargills', '{"adapter":{"kind":"cargills_api","settings":{}}}', 'Cargills', 'Cargills', 'https://cargills.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}');
    INSERT INTO market (id, type, label_en, scope_note) VALUES ('market_dambulla', 'wholesale_market', 'Dambulla', 't'), ('market_keells_online', 'online_store', 'Keells Online', 't'), ('market_cargills_online', 'online_store', 'Cargills Online', 't');
    INSERT INTO product (id, category, canonical_label_en, comparison) VALUES ('product_big_onion', 'vegetable', 'Big Onion', 'pooled'), ('product_banana', 'fruit', 'Banana', 'by_variety');
    INSERT INTO item (id, product_id, entity_type, canonical_label_en, origin, variety)
    VALUES ('item_big_onion', 'product_big_onion', 'commodity', 'Big Onion', NULL, NULL), ('item_big_onion_imported', 'product_big_onion', 'commodity', 'Big Onion', 'Imported', NULL),
           ('item_banana', 'product_banana', 'commodity', 'Banana', NULL, NULL), ('item_banana_kolikuttu', 'product_banana', 'variety', 'Banana', NULL, 'Kolikuttu');
    INSERT INTO unit_conversion_rule (id, source_unit, normalized_unit, factor_numerator, factor_denominator, rounding_mode, mapping_version) VALUES ('unit_kg_exact', 'kg', 'kg', 1, 1, 'half_away_from_zero', 'v1');
    INSERT INTO source_publication (id, source_id, source_publication_key, title, published_at, observed_from, observed_to, landing_url, download_url, status, first_seen_at, last_seen_at)
    VALUES ('pub_h', 'harti', 'h1', 'Bulletin', '${now}', '${day}', '${day}', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_k', 'keells', 'k1', 'Snapshot', '${now}', '${day}', '${day}', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_c', 'cargills', 'c1', 'Snapshot', '${now}', '${day}', '${day}', 'u', 'u', 'canonicalized', '${now}', '${now}');
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
  const add = (publication: string, artifact: string, item: string, market: string, priceType: string, observedOn: string, rupees: number) => {
    sequence += 1;
    const minor = rupees * 100;
    staging.run(`stg_${sequence}`, artifact, `row_${sequence}`, market, observedOn, priceType);
    insert.run(`obs_${sequence}`, `stg_${sequence}`, publication, artifact, item, market, priceType, minor, minor, minor, minor, observedOn, observedOn, `cmp_${sequence}`, `lin_${sequence}`, `eff_${sequence}`, `${observedOn}T02:00:00.000Z`);
  };
  add("pub_k", "art_k", "item_big_onion", "market_keells_online", "retail_online_store", ago(1), 300);
  add("pub_k", "art_k", "item_big_onion", "market_keells_online", "retail_online_store", day, 240);
  add("pub_k", "art_k", "item_big_onion_imported", "market_keells_online", "retail_online_store", ago(1), 320);
  add("pub_k", "art_k", "item_big_onion_imported", "market_keells_online", "retail_online_store", day, 256);
  add("pub_c", "art_c", "item_big_onion", "market_cargills_online", "retail_online_store", day, 400);
  add("pub_k", "art_k", "item_banana", "market_keells_online", "retail_online_store", ago(1), 200);
  add("pub_k", "art_k", "item_banana", "market_keells_online", "retail_online_store", day, 200);
  // A named variety of a by-variety product with a base variety: the site opens on the base alone, so the engine must too.
  add("pub_k", "art_k", "item_banana_kolikuttu", "market_keells_online", "retail_online_store", ago(1), 200);
  add("pub_k", "art_k", "item_banana_kolikuttu", "market_keells_online", "retail_online_store", day, 100);
  // A wholesale bulletin price is never a store deal.
  add("pub_h", "art_h", "item_big_onion", "market_dambulla", "wholesale_observed", day, 150);
  return { database, cleanup: () => { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("the stores' own offers come from the snapshot rows: newest day per store, ten percent and more, the deepest per product, base varieties only", async () => {
  const { database, cleanup } = seededWarehouse();
  const client = await embeddedWarehouse();
  try {
    database.exec(`INSERT INTO source_market_mapping (source_id, source_label, market_id, mapping_version, reviewed_by, reviewed_at, evidence_ref)
      VALUES ('keells', 'market_keells_online', 'market_keells_online', 'v1', 't', '2026-09-01', 'd'), ('cargills', 'market_cargills_online', 'market_cargills_online', 'v1', 't', '2026-09-01', 'd')`);
    const offer = database.prepare("UPDATE staging_observation SET source_item_label = ?, raw_json = ? WHERE id = ?");
    const raw = (list: number, price: number, extra: Record<string, unknown> = {}) => JSON.stringify({ offer: { list_minor: list, offer_minor: price, kind: "mrp", audience: "everyone", ...extra } });
    offer.run("Big Onion 1kg", raw(30_000, 24_000), "stg_2");
    offer.run("Big Onion Imported 1kg", raw(25_600, 17_920, { kind: "discount", audience: "members", label: "Nexus" }), "stg_4");
    offer.run("B Onion", raw(40_000, 38_000), "stg_5");
    offer.run("Banana yesterday", raw(40_000, 20_000), "stg_6");
    offer.run("Ambul Banana 1kg", raw(25_000, 20_000), "stg_7");
    offer.run("Kolikuttu 1kg", raw(20_000, 10_000), "stg_9");
    const synced = await syncWarehouse(database, client, { now: at });
    assert.deepEqual([synced.offers.rows, synced.offers.mapped], [6, 6]);

    const result = await computeDeals(client, { day: at, essentials: [] });
    assert.deepEqual(result.store_offers, [
      // image_path is the store's own picture of the pack, which the card draws beside the row; these
      // rows were never captured with one, so it comes through as null.
      { product_id: "product_big_onion", label: "Big Onion", store_label: "Big Onion Imported 1kg", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 17_920, was_minor: 25_600, pct: -30, audience: "members", offer_label: "Nexus", observed_on: day, url: "/p/product_big_onion", image_path: null },
      { product_id: "product_banana", label: "Banana", store_label: "Ambul Banana 1kg", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 20_000, was_minor: 25_000, pct: -20, audience: "everyone", offer_label: null, observed_on: day, url: "/p/product_banana", image_path: null },
    ], "the Cargills cut is under ten percent, yesterday's banana is not Keells' newest day, and the Kolikuttu is not the variety the product page opens on");
    assert.equal(result.deals.length, 1, "the day's drops are untouched");
  } finally {
    await client.close();
    cleanup();
  }
});

test("the window query runs against a real warehouse, reads the stores only, and pools a store's items", async () => {
  const { database, cleanup } = seededWarehouse();
  const client = await embeddedWarehouse();
  try {
    await syncWarehouse(database, client);
    const result = await computeDeals(client, { day: at, essentials: ["product_banana", "product_big_onion"] });
    assert.deepEqual(result.stats, { series: 4, fresh: 4, considered: 3 }, "two big onion items and one banana at Keells, big onion at Cargills; the Kolikuttu series and the Dambulla bulletin are out");
    assert.deepEqual(result.deals, [
      { product_id: "product_big_onion", label: "Big Onion", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 24000, was_minor: 30000, was_on: ago(1), pct: -20, kind: "offer", baseline: "yesterday", url: "/p/product_big_onion" },
    ], "both big onion items at Keells fell 20 %; the first in query order stands for the product");
    assert.deepEqual(result.cheapest, [
      { product_id: "product_big_onion", label: "Big Onion", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 24800, was_minor: 40000, was_on: day, pct: -38, kind: "cheapest", baseline: "other_stores", url: "/p/product_big_onion" },
    ], "Keells' pooled price (the average of its two big onion items) undercuts Cargills");
    assert.deepEqual(result.movers_up, []);
    assert.deepEqual(result.essentials, [
      { product_id: "product_banana", label: "Banana", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 20000 }, change_pct: 0, trend: "flat" },
      { product_id: "product_big_onion", label: "Big Onion", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 24800 }, change_pct: -20, trend: "flat" },
    ]);
    assert.deepEqual(result.stores, [
      { market_id: "market_cargills_online", label: "Cargills Online", series: 1, deals: 0 },
      { market_id: "market_keells_online", label: "Keells Online", series: 3, deals: 2 },
    ], "the offer and the cheapest-store pick both count for Keells");
  } finally {
    await client.close();
    cleanup();
  }
});
