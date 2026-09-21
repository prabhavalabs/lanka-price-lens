import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { createApp } from "../src/app.ts";
import { cardHeight, cardSvg, cardWidth, formatDate, pageCard, productCard, recipeCard, renderCard, siteCard, wrapText } from "../src/og.ts";
import { Presence } from "../src/presence.ts";

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

test("cards render as 1200 by 630 PNGs in the site's font, from whatever data is at hand", () => {
  const site = renderCard(siteCard(null));
  assert.equal(site.subarray(1, 4).toString("ascii"), "PNG");
  assert.deepEqual(pngSize(site), { width: cardWidth, height: cardHeight });
  const product = productCard({ id: "product_big_onion", label: "Big Onion", label_si: null, label_ta: null, category: "Vegetables", comparison: "pooled", prices: [{ group: "retail_market", unit: "kg", sellers: 4, low: 250, high: 297, mid: 270, observed_on: "2026-09-07", change_30d_pct: 27.4 } as never] }, null);
  const svg = cardSvg(product);
  assert.match(svg, /Big Onion/u);
  assert.match(svg, /Rs 250 – 297 per kg/u);
  assert.match(svg, /\+27% in 30 days/u);
  assert.deepEqual(pngSize(renderCard(product)), { width: cardWidth, height: cardHeight });
  const recipe = recipeCard({ id: "dish_x", names: { en: "Devilled squid" }, summary: "Squid rings flash cooked with onion, capsicum and chilli.", category: "seafood", difficulty: "moderate", prep_minutes: 15, cook_minutes: 10, key_ingredients: [1, 2, 3], other_ingredients: [1] }, null);
  assert.match(cardSvg(recipe), /Devilled squid/u);
  assert.match(cardSvg(recipe), /25 min/u);
  assert.ok(pageCard("guide", null));
  assert.equal(pageCard("nope", null), null);
  assert.equal(formatDate("2026-09-07"), "7 Sept 2026");
});

test("long titles wrap to two lines and end in an ellipsis when cut", () => {
  const lines = wrapText("Dried Sprats (Halmasso) Imported Large Grade Special Pack Family Size", 64, 620, 2, 600);
  assert.equal(lines.length, 2);
  assert.ok(lines[1]!.endsWith("…"));
  assert.deepEqual(wrapText("Big Onion", 64, 620, 2, 600), ["Big Onion"]);
});

test("the card routes answer with PNGs, falling back to the site card for unknown ids", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const app = createApp(database, undefined, undefined, { presence: new Presence() });
    for (const path of ["/og/site.png", "/og/page/guide.png", "/og/page/nope.png", "/og/p/product_unknown.png", "/og/r/dish_unknown.png"]) {
      const response = await app.request(`http://localhost${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers.get("content-type"), "image/png", path);
      assert.match(response.headers.get("cache-control") ?? "", /public, max-age=\d+/u);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(pngSize(bytes), { width: cardWidth, height: cardHeight }, path);
      // The drawing is the tag, so a card redrawn under the same address is fetched again and an
      // unchanged one costs a 304 rather than a second render.
      const tag = response.headers.get("etag") ?? "";
      assert.match(tag, /^"[\w-]{10,}"$/u, path);
      const again = await app.request(`http://localhost${path}`, { headers: { "if-none-match": tag } });
      assert.equal(again.status, 304, path);
    }
  } finally {
    database.close();
  }
});
