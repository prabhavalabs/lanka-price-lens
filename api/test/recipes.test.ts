import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { listDishes, readRecipeStore, recipeOverview } from "../src/recipes.ts";

const store = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
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
const request = { search: "", category: "", meal: "", protein: "", diet: "", region: "", occasion: "", page: 1, pageSize: 20 };

test("dish catalogue lists, searches in any name, filters, and measures price coverage", () => {
  assert.equal(store.catalogue.dishes.length, 3);
  const all = listDishes(store, request, null);
  assert.deepEqual(all.items.map((dish) => dish.id), ["dish_chicken_curry", "dish_parippu", "dish_red_rice"], "everyday dishes sort by name");
  assert.deepEqual(listDishes(store, { ...request, search: "paruppu" }, null).items.map((dish) => dish.id), ["dish_parippu"], "a Tamil romanised name finds the dish");
  assert.deepEqual(listDishes(store, { ...request, search: "පරිප්පු" }, null).items.map((dish) => dish.id), ["dish_parippu"], "a Sinhala script name finds the dish");
  assert.deepEqual(listDishes(store, { ...request, search: "pandan" }, null).items.map((dish) => dish.id), ["dish_chicken_curry"], "an unpriced ingredient finds the dish");
  assert.deepEqual(listDishes(store, { ...request, protein: "dhal" }, null).items.map((dish) => dish.id), ["dish_parippu"]);
  assert.deepEqual(listDishes(store, { ...request, meal: "breakfast", diet: "vegan" }, null).items.map((dish) => dish.id), ["dish_parippu"]);
  assert.equal(listDishes(store, { ...request, category: "sweet" }, null).total, 0);
  const priced = new Set(["product_red_dhal", "product_big_onion", "product_rice_raw_red", "product_chicken"]);
  const withPrices = listDishes(store, request, priced);
  assert.deepEqual(withPrices.items.map((dish) => [dish.id, dish.coverage?.priced, dish.coverage?.total]), [["dish_chicken_curry", 2, 5], ["dish_parippu", 2, 3], ["dish_red_rice", 1, 1]]);
  const overview = recipeOverview(store, priced);
  assert.deepEqual([overview.dishes, overview.coverage], [3, { products: 7, priced: 4, dishes_fully_priced: 1 }]);
  assert.deepEqual(overview.unpriced_ingredients.slice(0, 2), [{ ingredient: "coconut milk", dishes: 2 }, { ingredient: "curry leaves", dishes: 2 }], "the pantry backlog is ordered by how many dishes need it");
  assert.deepEqual(overview.references, { channels: 1, blogs: 0, institutional: 0 });
});

test("recipe routes serve the catalogue to a signed-in owner and answer 503 without one", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
  try {
    const app = createApp(database, manifest, undefined, { recipes: store });
    assert.equal((await app.request("http://localhost/v1/admin/recipes/dishes")).status, 401);
    const login = await app.request("http://localhost/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const list = await app.request("http://localhost/v1/admin/recipes/dishes?search=curry&pageSize=10", { headers: { cookie } });
    assert.equal(list.status, 200);
    const page = ((await list.json()) as { payload: { items: Array<{ id: string; coverage: unknown }>; total: number } }).payload;
    assert.deepEqual([page.total, page.items.map((dish) => dish.id), page.items[0]?.coverage], [2, ["dish_chicken_curry", "dish_parippu"], null], "without a warehouse, coverage is unknown rather than zero");
    const detail = await app.request("http://localhost/v1/admin/recipes/dishes/dish_parippu", { headers: { cookie } });
    assert.equal(detail.status, 200);
    const dish = ((await detail.json()) as { payload: { pairs: Array<{ id: string; label: string }>; ingredients: Array<{ product_id: string; price: unknown }> } }).payload;
    assert.deepEqual(dish.pairs, [{ id: "dish_red_rice", label: "Red rice" }]);
    assert.equal(dish.ingredients.length, 3);
    assert.equal((await app.request("http://localhost/v1/admin/recipes/dishes/dish_nope", { headers: { cookie } })).status, 404);
    const overview = await app.request("http://localhost/v1/admin/recipes/overview", { headers: { cookie } });
    assert.equal(((await overview.json()) as { payload: { dishes: number } }).payload.dishes, 3);
    const references = await app.request("http://localhost/v1/admin/recipes/references", { headers: { cookie } });
    assert.equal(((await references.json()) as { payload: { channels: unknown[] } }).payload.channels.length, 1);
    const bare = createApp(database, manifest);
    assert.equal((await bare.request("http://localhost/v1/admin/recipes/dishes", { headers: { cookie } })).status, 503);
  } finally {
    database.close();
  }
});

test("recipes are recommended from the basket, best fit first, with what is still to buy", async () => {
  const { recommendDishes } = await import("../src/recipes.ts");
  // Dhal, onion, and coconut: parippu is fully covered; chicken curry shares two of five.
  const full = recommendDishes(store, ["product_red_dhal", "product_big_onion", "product_coconut"]);
  assert.deepEqual(full.map((entry) => entry.dish.id), ["dish_parippu", "dish_chicken_curry"]);
  assert.deepEqual([full[0]!.coverage, full[0]!.usage, full[0]!.missing], [1, 1, []]);
  assert.deepEqual(full[1]!.missing, ["product_chicken", "product_garlic", "product_ginger"]);
  // One shared ingredient is enough to appear; a dish with none does not.
  const onion = recommendDishes(store, ["product_big_onion"]);
  assert.deepEqual(onion.map((entry) => entry.dish.id), ["dish_parippu", "dish_chicken_curry"], "the smaller dish that onion covers more of comes first");
  assert.ok(!onion.some((entry) => entry.dish.id === "dish_red_rice"));
  assert.deepEqual(recommendDishes(store, []), []);
  assert.deepEqual(recommendDishes(store, ["product_unknown"]), []);
  assert.equal(recommendDishes(store, ["product_big_onion"], { limit: 1 }).length, 1);
});

test("public recipe routes browse, look up, and recommend without sign-in", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const app = createApp(database, undefined, undefined, { recipes: store });
    const list = await app.request("http://localhost/v1/public/recipes?q=parippu");
    assert.equal(list.status, 200);
    assert.equal(list.headers.get("cache-control")?.includes("public"), true);
    const listed = (await list.json()) as { payload: { total: number; items: Array<{ id: string }> } };
    assert.deepEqual([listed.payload.total, listed.payload.items[0]?.id], [1, "dish_parippu"]);

    const detail = await app.request("http://localhost/v1/public/recipes/dish_chicken_curry");
    assert.equal(detail.status, 200);
    const dish = (await detail.json()) as { payload: { id: string; ingredients: Array<{ product_id: string; price: unknown }>; pairs: unknown[] } };
    assert.equal(dish.payload.ingredients.length, 5, "every key ingredient is listed, priced or not");
    assert.equal((await app.request("http://localhost/v1/public/recipes/dish_missing")).status, 404);

    const recommend = await app.request("http://localhost/v1/public/recipes/recommend?products=product_red_dhal,product_coconut,bad%20id");
    assert.equal(recommend.status, 200);
    const body = (await recommend.json()) as { payload: { recommendations: Array<{ dish: { id: string }; missing: string[] }>; labels: Record<string, string> } };
    assert.equal(body.payload.recommendations[0]?.dish.id, "dish_parippu");
    assert.deepEqual(body.payload.recommendations[0]?.missing, ["product_big_onion"]);
    const empty = (await (await app.request("http://localhost/v1/public/recipes/recommend")).json()) as { payload: { recommendations: unknown[] } };
    assert.deepEqual(empty.payload.recommendations, []);

    const dark = createApp(database);
    assert.equal((await dark.request("http://localhost/v1/public/recipes")).status, 503);
  } finally {
    database.close();
  }
});
