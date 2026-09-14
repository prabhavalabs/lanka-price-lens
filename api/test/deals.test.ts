import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { saveDealsDay, type DealsDay } from "@lanka-pricelens/foundry/deals";
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
