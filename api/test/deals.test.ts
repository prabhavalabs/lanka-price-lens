import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { dealsEngine, saveDealsDay, type DealsDay } from "@lanka-pricelens/foundry/deals";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { dealsRoutes, type DealsBindings } from "../src/deals.ts";

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string; meta: { request_id: string } };

const sample: DealsDay = {
  day: "2026-09-14",
  computed_at: "2026-09-14T02:05:00.000Z",
  stores: [{ market_id: "market_keells_online", label: "Keells Online", series: 97, deals: 2 }],
  deals: [{ product_id: "product_potato", label: "Potato", unit: "kg", market_id: "market_keells_online", market: "Keells Online", now_minor: 26400, was_minor: 30000, was_on: "2026-09-13", pct: -12, kind: "drop", baseline: "yesterday", url: "/p/product_potato" }],
  cheapest: [{ product_id: "product_egg", label: "Egg", unit: "each", market_id: "market_keells_online", market: "Keells Online", now_minor: 3000, was_minor: 3600, was_on: "2026-09-14", pct: -16.7, kind: "cheapest", baseline: "other_stores", url: "/p/product_egg" }],
  movers_up: [],
  essentials: [{ product_id: "product_potato", label: "Potato", unit: "kg", cheapest: { market_id: "market_keells_online", market: "Keells Online", price_minor: 26400 }, change_pct: -12, trend: "down" }],
  stats: { series: 97, fresh: 90, considered: 80 },
  engine: dealsEngine,
};

test("deals today answers 503 until a day is saved, then the latest day in the envelope", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const app = new Hono<DealsBindings>();
    app.use("*", requestId());
    app.route("/v1/public/deals", dealsRoutes({ database }));

    const missing = await app.request("http://localhost/v1/public/deals/today");
    assert.equal(missing.status, 503);
    const refused = (await missing.json()) as Envelope<null>;
    assert.equal(refused.success, false);
    assert.equal(refused.code, "DEALS_UNAVAILABLE");
    assert.equal(refused.payload, null);
    assert.ok(refused.meta.request_id);

    saveDealsDay(database, { ...sample, day: "2026-09-13", computed_at: "2026-09-13T02:05:00.000Z" });
    saveDealsDay(database, sample);
    const answered = await app.request("http://localhost/v1/public/deals/today");
    assert.equal(answered.status, 200);
    const body = (await answered.json()) as Envelope<DealsDay>;
    assert.equal(body.success, true);
    assert.deepEqual(body.payload, sample, "the newest saved day, as saved");
    assert.equal(body.code, undefined);
  } finally {
    database.close();
  }
});

test("the deals mail carries the stores' own offers after the drops, words a members' price, and a day with offers alone is worth sending", async () => {
  const { composeDealsMail, dealsBlocks, hasSomethingToSay, offerRowOf } = await import("../src/newsletters/deals.ts");
  const { sampleDealsDay } = await import("../src/newsletters/admin-routes.ts");
  const sample = sampleDealsDay("2026-09-19");
  const blocks = dealsBlocks(sample, "https://price.example/");
  assert.deepEqual(blocks.map((block) => (block.type === "deals" ? block.heading : block.type)), ["Biggest drops today", "Store offers today", "Cheapest store today", "Household essentials", "Going up"]);
  assert.deepEqual(offerRowOf(sample.store_offers![1]!, "https://price.example"), {
    product: "Chicken, whole", store: "20% off at Keells with Nexus", image: null, now: "Rs 1,120 / kg", was: "Whole Chicken Skinless, regular price Rs 1,400 / kg", pct: -20, url: "https://price.example/p/product_chicken",
  });
  assert.equal(offerRowOf(sample.store_offers![0]!, "https://price.example").store, "16% off at Cargills");

  const offersOnly: DealsDay = { ...sample, deals: [], cheapest: [], movers_up: [], essentials: [] };
  assert.equal(hasSomethingToSay(offersOnly), true);
  assert.equal(composeDealsMail({ display_name: "Nimal" }, offersOnly, { siteOrigin: "https://price.example" })?.summary.offers, 2);
  // A day saved before the engine read store offers has no such list, and still composes.
  const { store_offers: _none, ...older } = sample;
  assert.deepEqual(dealsBlocks(older, "https://price.example").map((block) => (block.type === "deals" ? block.heading : "")), ["Biggest drops today", "Cheapest store today", "Household essentials", "Going up"]);
  assert.equal(hasSomethingToSay({ ...older, deals: [], cheapest: [], essentials: [] }), false);
});

test("a day an older engine saved still answers the site, and the mail and the post compute it again", async () => {
  const { dealsAccessFor } = await import("../src/newsletters/deals.ts");
  const database = openOperationalDatabase(":memory:");
  try {
    // The engine gained the store's picture of the pack after this day was saved; the card draws
    // from the saved day, so a reader that can recompute must not be handed the older shape.
    const { engine: _older, ...stale } = sample;
    saveDealsDay(database, stale);
    const deals = dealsAccessFor({ database, warehouse: async () => null, essentials: () => [] });
    assert.deepEqual(deals.latest(), stale, "the site keeps the morning's day rather than going empty");
    assert.equal(deals.read(sample.day), null, "the mail and the post are told to compute the day");
    assert.equal(await deals.compute(sample.day), null, "and without a warehouse they say so rather than posting the older day");

    saveDealsDay(database, sample);
    assert.deepEqual(deals.read(sample.day), sample);
  } finally {
    database.close();
  }
});
