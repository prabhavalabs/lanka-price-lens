import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { createSourceCatalog } from "@lanka-pricelens/foundry/manifest";
import { sourceManifestSchema, type Recipe } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { buildRecipeIndex, parseRecipeQuery, priceLookupFor, priceOptions, purchaseFor, queryRecipes, recipeView, stepViews } from "../src/recipe-views.ts";
import { readRecipeStore } from "../src/recipes.ts";
import { seed, warehouseFor } from "./helpers/warehouse.ts";

const store = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
const index = buildRecipeIndex(store);

const manifestFor = (id: string, name: string, adapter?: unknown) =>
  sourceManifestSchema.parse({
    id,
    name,
    owner: name,
    landing_url: `https://${id}.example/`,
    retrieval_method: adapter ? "api_snapshot" : "scheduled_download",
    expected_cadence: "daily",
    formats: [adapter ? "json" : "pdf"],
    geographic_scope: "t",
    price_types: [adapter ? "retail_online_store" : "wholesale_observed"],
    rights_status: "approved_permission",
    rights_evidence_ref: "docs",
    attribution_text: `Source: ${name}`,
    retention_policy: "preserve_source_evidence",
    parser_owner: "tests",
    reviewed_by: "tests",
    reviewed_at: "2026-01-01",
    review_due_at: "2099-01-01",
    request_interval_ms: 1000,
    max_attempts: 3,
    enabled: true,
    ...(adapter ? { adapter } : {}),
  });

test("the store loads the registry and the recipes, and the index carries nutrition, minutes, and earned tags", () => {
  assert.equal(store.registry.size, 5);
  assert.deepEqual([...store.recipes.keys()], ["dish_chicken_curry", "dish_parippu"]);
  const parippu = index.get("dish_parippu")!;
  // dhal 200 g → 700 kcal; onion 120 × 0.9 → 43; coconut milk 200 → 380; over four.
  assert.equal(parippu.metrics.kcal, 281);
  assert.equal(parippu.metrics.protein_g, 13.3);
  assert.equal(parippu.metrics.minutes, 25);
  assert.deepEqual(parippu.metrics.languages, ["en", "si", "ta"]);
  assert.ok(parippu.metrics.tags.includes("budget"), "curated tags stay");
  assert.ok(parippu.metrics.tags.includes("high_protein"), "13 g of protein in a side earns the tag");
  assert.ok(parippu.metrics.tags.includes("high_fibre"));
  assert.equal(index.has("dish_red_rice"), false, "a dish without a recipe is not indexed");
});

test("a recipe view scales to the headcount and keeps per-serving nutrition; a menu totals and merges the shopping list", () => {
  const six = recipeView(store, index, "dish_parippu", 6, null)!;
  assert.equal(six.servings, 6);
  assert.deepEqual(six.ingredients.map((line) => [line.label.en, line.quantity, line.household]), [["red dhal", 300, "1½ cup"], ["big onion", 1.5, null], ["coconut milk", 300, "1¼ cup"], ["salt", 8, "1¼ tsp"]], "spoons and cups are derived for weighed lines; a count is its own measure");
  assert.equal(six.ingredients[0]!.names?.si, "පරිප්පු");
  assert.equal(six.nutrition.per_serving.kcal, 281);
  assert.equal(six.yield_g, 975);
  assert.equal(six.cost, null, "no prices, no cost");
  assert.equal(recipeView(store, index, "dish_red_rice", 4, null), null);
});

test("steps name the ingredient lines they use, in any of the three languages", () => {
  const recipe = store.recipes.get("dish_parippu")!;
  const en = stepViews(recipe.steps.en, recipe.ingredients, "en");
  assert.deepEqual(en.map((step) => step.uses), [[0], [1, 2], [3]], "dhal; onion and coconut milk; salt");
  const si = stepViews(recipe.steps.si!, recipe.ingredients, "si");
  assert.deepEqual(si.map((step) => step.uses), [[0], [1, 2], [3]]);
  const ta = stepViews(recipe.steps.ta!, recipe.ingredients, "ta");
  assert.deepEqual(ta.map((step) => step.uses), [[0], [1, 2], [3]]);
  const plural = stepViews([{ text: "Slice the onions and fry the chillies.", minutes: null }], [{ ref: "product_big_onion", label: { en: "big onion", si: null, ta: null }, quantity: 1, unit: "piece", household: null, preparation: null, optional: false, scaling: "linear", part: "main" }, { ref: "product_green_chillies", label: { en: "green chilli, slit", si: null, ta: null }, quantity: 2, unit: "piece", household: null, preparation: null, optional: false, scaling: "linear", part: "main" }], "en");
  assert.deepEqual(plural[0]!.uses, [0, 1], "plurals in the step match singular labels; a two-word label needs only its head word");
  const strict = stepViews([{ text: "Pour in the milk.", minutes: null }], [{ ref: "pantry_coconut_milk", label: { en: "thick coconut milk, first squeeze", si: null, ta: null }, quantity: 200, unit: "ml", household: null, preparation: null, optional: false, scaling: "linear", part: "main" }], "en");
  assert.deepEqual(strict[0]!.uses, [], "a three-word label needs its whole phrase");
  const line = (ref: string, en: string, preparation: string | null = null): Recipe["ingredients"][number] => ({ ref, label: { en, si: null, ta: null }, quantity: 1, unit: "g", household: null, preparation: preparation ? { en: preparation, si: null, ta: null } : null, optional: false, scaling: "linear", part: "main" });
  const curry = [line("product_green_chillies", "green chillies"), line("pantry_chilli_powder", "chilli powder"), line("product_curry_leaves", "curry leaves"), line("pantry_curry_powder", "curry powder"), line("pantry_coconut_milk_thin", "coconut milk", "thin, second squeeze"), line("pantry_coconut_milk", "coconut milk", "thick, first squeeze")];
  const phrases = stepViews([{ text: "Mix in the curry powder and chilli powder and leave it to take the spice.", minutes: null }, { text: "Temper the green chillies and curry leaves.", minutes: null }, { text: "Pour in the thin coconut milk and simmer.", minutes: null }, { text: "Add the coconut milk and heat without boiling.", minutes: null }], curry, "en");
  assert.deepEqual(phrases.map((step) => step.uses), [[1, 3], [0, 2], [4], [4, 5]], "phrases are consumed before head words; 'leave it' is not curry leaves; a named squeeze keeps only its line");
  const unique = stepViews([{ text: "Rub in the turmeric and drop in the pandan.", minutes: null }, { text: "Stir the powder in.", minutes: null }], [line("product_turmeric", "turmeric powder"), line("pantry_pandan_leaf", "pandan leaf"), line("pantry_chilli_powder", "chilli powder")], "en");
  assert.deepEqual(unique.map((step) => step.uses), [[0, 1], []], "an ambiguous head word yields to a first word that names one ingredient alone");
});

test("the purchase amount is in the basket's unit: the priced unit when priced, the line's own otherwise, rounded up", () => {
  const onion = store.registry.get("product_big_onion");
  assert.deepEqual(purchaseFor({ ref: "product_big_onion", quantity: 120, unit: "g" }, { ref: "product_big_onion", label: "onion", quantity: 120, unit: "g", amount: 0.12, price_unit: "kg", unit_price: 255, cost: 30.6, seller: "Dambulla", observed_on: "2026-09-04", stale: false }, onion), { quantity: 0.12, unit: "kg" });
  assert.deepEqual(purchaseFor({ ref: "product_big_onion", quantity: 1.5, unit: "piece" }, { ref: "product_big_onion", label: "onion", quantity: 1.5, unit: "piece", amount: 1.5, price_unit: "piece", unit_price: 40, cost: 60, seller: "Keells", observed_on: "2026-09-04", stale: false }, onion), { quantity: 2, unit: "piece" }, "pieces round up to whole");
  assert.deepEqual(purchaseFor({ ref: "product_big_onion", quantity: 6, unit: "g" }, null, onion), { quantity: 0.05, unit: "kg" }, "an unpriced product line still buys at least fifty grams");
  assert.deepEqual(purchaseFor({ ref: "product_big_onion", quantity: 0.25, unit: "g" }, { ref: "product_big_onion", label: "onion", quantity: 0.25, unit: "g", amount: 0, price_unit: "kg", unit_price: 255, cost: 0.06, seller: "Dambulla", observed_on: "2026-09-04", stale: false }, onion), { quantity: 0.05, unit: "kg" }, "a pinch whose priced amount rounds to nothing still buys the minimum");
  assert.deepEqual(purchaseFor({ ref: "product_big_onion", quantity: 0.5, unit: "piece" }, null, onion), { quantity: 1, unit: "piece" });
  assert.equal(purchaseFor({ ref: "pantry_coconut_milk", quantity: 200, unit: "ml" }, null, undefined), null, "pantry entries are not in the basket's vocabulary");
});

test("the query filters on the index and sorts by the asked measure", () => {
  const light = queryRecipes(store, index, parseRecipeQuery((name) => ({ max_kcal: "300" })[name]), null);
  assert.deepEqual(light.items.map((item) => item.dish.id), ["dish_parippu"]);
  const protein = queryRecipes(store, index, parseRecipeQuery((name) => ({ sort: "protein" })[name]), null);
  assert.deepEqual(protein.items.map((item) => item.dish.id), ["dish_chicken_curry", "dish_parippu"]);
  const tagged = queryRecipes(store, index, parseRecipeQuery((name) => ({ tags: "budget,high_fibre" })[name]), null);
  assert.deepEqual(tagged.items.map((item) => item.dish.id), ["dish_parippu"]);
  const quick = queryRecipes(store, index, parseRecipeQuery((name) => ({ max_minutes: "30", q: "dhal" })[name]), null);
  assert.deepEqual(quick.items.map((item) => item.dish.id), ["dish_parippu"]);
  assert.equal(queryRecipes(store, index, parseRecipeQuery((name) => ({ tags: "nonsense" })[name]), null).total, 2, "unknown tags are ignored");
});

test("prices come per product and unit from the published sources, fresh and cheapest first, and cost follows the unit the recipe can convert", async () => {
  const database = openOperationalDatabase(":memory:");
  seed(database);
  const client = await warehouseFor(database);
  try {
    const sources = [manifestFor("harti", "HARTI"), manifestFor("keells", "Keells", { kind: "keells_api", settings: {} }), manifestFor("cargills", "Cargills", { kind: "cargills_api", settings: {} })];
    const options = await priceOptions(client, sources, ["product_big_onion", "product_egg", "product_chicken"], new Date("2026-09-05T00:00:00Z"));
    const onion = options.get("product_big_onion")!;
    assert.equal(onion[0]!.unit, "kg");
    assert.equal(onion[0]!.price, 255, "Dambulla's cheapest variety (imported) on its newest day, fresh");
    assert.equal(onion[0]!.stale, false);
    assert.equal(options.has("product_chicken"), false, "nothing priced, no options");
    const lookup = priceLookupFor(options, store.registry);
    // A packet of leaves priced "per piece" must not price a sprig: with a piece weight under 20 g the kilo price wins.
    const leafOptions = new Map([["product_curry_leaves", [{ product_id: "product_curry_leaves", price: 30, unit: "piece" as const, seller: "Glomark", observed_on: "2026-09-04", stale: false }, { product_id: "product_curry_leaves", price: 1200, unit: "kg" as const, seller: "Pettah", observed_on: "2026-09-04", stale: false }]]]);
    const leafRegistry = new Map([["product_curry_leaves", { ...store.registry.get("product_big_onion")!, id: "product_curry_leaves", measures: { tsp_g: null, tbsp_g: null, cup_g: 20, piece_g: 0.2, bunch_g: null } }]]);
    assert.equal(priceLookupFor(leafOptions, leafRegistry)("product_curry_leaves", { quantity: 5, unit: "piece" })?.unit, "kg");
    const eggOptions = new Map([["product_egg", [{ product_id: "product_egg", price: 900, unit: "kg" as const, seller: "Pettah", observed_on: "2026-09-04", stale: false }, { product_id: "product_egg", price: 40, unit: "piece" as const, seller: "Keells", observed_on: "2026-09-04", stale: false }]]]);
    const eggRegistry = new Map([["product_egg", { ...store.registry.get("product_big_onion")!, id: "product_egg", measures: { tsp_g: null, tbsp_g: null, cup_g: null, piece_g: 55, bunch_g: null } }]]);
    assert.equal(priceLookupFor(eggOptions, eggRegistry)("product_egg", { quantity: 2, unit: "piece" })?.unit, "piece", "eggs are counted and priced whole");
    assert.equal(priceLookupFor(eggOptions, eggRegistry)("product_egg", { quantity: 110, unit: "g" })?.unit, "piece", "even a line in grams prices eggs by the piece through the piece weight");
    const view = recipeView(store, index, "dish_parippu", 4, lookup)!;
    assert.equal(view.cost?.lines.length, 1, "only the onion is priced in the seeded warehouse");
    assert.equal(view.cost?.lines[0]!.cost, 30.6, "one 120 g onion at Rs 255 a kilo");
    assert.deepEqual(view.cost?.unpriced, ["red dhal", "coconut milk", "salt"]);
    assert.equal(view.cost?.estimated, true);
    assert.equal(view.ingredients[1]!.priced, true);
    assert.equal(view.ingredients[0]!.priced, false);
    assert.deepEqual([view.ingredients[1]!.cost?.unit_price, view.ingredients[1]!.cost?.amount, view.ingredients[1]!.cost?.seller, view.ingredients[1]!.purchase], [255, 0.12, "Dambulla", { quantity: 0.12, unit: "kg" }], "the line carries its own breakdown and what to put in the basket");
    assert.deepEqual(view.steps.en.map((step) => step.uses), [[0], [1, 2], [3]]);

    const catalog = createSourceCatalog(sources.map((manifest) => ({ manifest, mappingBundle: undefined })));
    const app = createApp(database, undefined, undefined, { recipes: store, catalog, warehouse: async () => client });
    const detail = await app.request("http://localhost/v1/public/recipes/dish_parippu?servings=2");
    assert.equal(detail.status, 200);
    const payload = (await detail.json()) as { payload: { id: string; recipe: { servings: number; ingredients: Array<{ quantity: number }>; nutrition: { per_serving: { kcal: number } }; cost: { per_serving: number } } } };
    assert.equal(payload.payload.recipe.servings, 2);
    assert.equal(payload.payload.recipe.ingredients[0]!.quantity, 100);
    assert.equal(payload.payload.recipe.nutrition.per_serving.kcal, 281);
    assert.equal(payload.payload.recipe.cost.per_serving, 7.65, "half an onion for two, over two");

    const query = await app.request("http://localhost/v1/public/recipes/query?max_kcal=300&sort=cost");
    const results = (await query.json()) as { payload: { items: Array<{ dish: { id: string }; cost_per_serving: number | null }> } };
    assert.deepEqual(results.payload.items.map((item) => [item.dish.id, item.cost_per_serving]), [["dish_parippu", 7.65]]);

    const menu = await app.request("http://localhost/v1/public/menus/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "menu_1", name: "Poya lunch", people: 10, items: [{ recipe_id: "dish_parippu" }, { recipe_id: "dish_chicken_curry", servings: 5 }, { recipe_id: "dish_nope" }], created_at: "2026-09-13T06:00:00.000Z" }) });
    assert.equal(menu.status, 200);
    const totals = (await menu.json()) as { payload: { items: Array<{ recipe_id: string; servings: number }>; shopping: Array<{ ref: string | null; label: string; quantity: number; unit: string; recipes: string[] }>; per_person: { nutrition: { kcal: number }; cost: number }; unknown: string[]; names: Record<string, { en: string }> } };
    assert.deepEqual(totals.payload.items.map((item) => [item.recipe_id, item.servings]), [["dish_parippu", 10], ["dish_chicken_curry", 5]]);
    assert.deepEqual(totals.payload.unknown, ["dish_nope"]);
    assert.equal(totals.payload.names.dish_parippu!.en, "Dhal curry");
    const onions = totals.payload.shopping.find((line) => line.ref === "product_big_onion");
    assert.deepEqual([onions?.quantity, onions?.unit, onions?.recipes], [4, "piece", ["dish_parippu", "dish_chicken_curry"]], "2.5 onions for ten of dhal plus 1.5 for five of curry (1.25 rounded up), as the recipe cards show them");
    assert.ok(totals.payload.per_person.nutrition.kcal > 0);
    assert.equal(totals.payload.per_person.cost, Math.round((2.5 * 0.12 * 255 * 100 + 1.5 * 0.12 * 255 * 100) / 10) / 100);

    const bad = await app.request("http://localhost/v1/public/menus/compute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x", people: 0, items: [] }) });
    assert.equal(bad.status, 400);
  } finally {
    await client.close();
    database.close();
  }
});
