import assert from "node:assert/strict";
import test from "node:test";

import { atwaterEnergy, computedTags, householdMeasure, ingredientRegistrySchema, ingredientSchema, menuSchema, menuTotals, quantityInPricedUnit, recipeCost, recipeNutrition, recipeSchema, roundKitchen, scaleFactor, scaleIngredients, type Ingredient, type IngredientPrice, type Recipe } from "../src/index.ts";

const registry = new Map<string, Ingredient>(
  [
    { id: "product_chicken", names: { en: "Chicken" }, group: "poultry", state: "raw", as_purchased_note: "curry cut, bone in", edible_portion: 0.68, nutrition: { kcal: 215, protein_g: 18.6, fat_g: 15.1, carb_g: 0 }, basis: "USDA meat and skin", confidence: "high" },
    { id: "pantry_coconut_milk", names: { en: "Coconut milk" }, group: "dairy", state: "raw", edible_portion: 1, density_g_per_ml: 1, measures: { cup_g: 240, tbsp_g: 15, tsp_g: 5, piece_g: null, bunch_g: null }, nutrition: { kcal: 190, protein_g: 2, fat_g: 20, carb_g: 3, fibre_g: 0 }, basis: "home squeezed, thick", confidence: "medium" },
    { id: "product_salt", names: { en: "Salt" }, group: "condiment", state: "processed", edible_portion: 1, measures: { tsp_g: 6, tbsp_g: 18, cup_g: null, piece_g: null, bunch_g: null }, nutrition: { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, sodium_mg: 38_000 }, basis: "table salt", confidence: "high" },
    { id: "product_big_onion", names: { en: "Big onion" }, group: "vegetable", state: "raw", edible_portion: 0.9, measures: { piece_g: 120, tsp_g: null, tbsp_g: null, cup_g: null, bunch_g: null }, nutrition: { kcal: 40, protein_g: 1.1, fat_g: 0.1, carb_g: 9.3, fibre_g: 1.7 }, basis: "USDA onions raw", confidence: "high" },
    { id: "product_egg", names: { en: "Egg" }, group: "egg", state: "raw", edible_portion: 0.88, measures: { piece_g: 55, tsp_g: null, tbsp_g: null, cup_g: null, bunch_g: null }, nutrition: { kcal: 143, protein_g: 12.6, fat_g: 9.5, carb_g: 0.7 }, basis: "USDA whole egg", confidence: "high" },
  ].map((entry) => [entry.id, ingredientSchema.parse(entry)]),
);
const lookup = (id: string) => registry.get(id);

const curry: Recipe = recipeSchema.parse({
  id: "dish_chicken_curry",
  base_servings: 4,
  serving: { role: "with_rice", portion_g: 180, description: { en: "A ladle with rice" } },
  yield_g: 900,
  ingredients: [
    { ref: "product_chicken", label: { en: "chicken, curry cut" }, quantity: 600, unit: "g", household: "about half a bird" },
    { ref: "pantry_coconut_milk", label: { en: "coconut milk, thick" }, quantity: 200, unit: "ml", household: "1 cup" },
    { ref: "product_big_onion", label: { en: "big onion" }, quantity: 1, unit: "piece" },
    { ref: "product_salt", label: { en: "salt" }, quantity: 6, unit: "g", household: "1 tsp", scaling: "sublinear" },
    { ref: null, label: { en: "pandan leaf" }, quantity: 1, unit: "piece", scaling: "fixed" },
    { ref: "product_egg", label: { en: "egg, for garnish" }, quantity: 1, unit: "piece", optional: true },
  ],
  steps: { en: [{ text: "Marinate the chicken." }, { text: "Simmer in coconut milk.", minutes: 30 }], si: [{ text: "…" }, { text: "…" }], ta: null },
  times: { prep_minutes: 15, cook_minutes: 40 },
  tags: ["high_protein"],
});

test("scaling: linear grows with the headcount, sublinear slower, fixed not at all, rounded to kitchen amounts", () => {
  assert.equal(scaleFactor(4, 8, "linear"), 2);
  assert.equal(scaleFactor(4, 4, "sublinear"), 1);
  assert.ok(Math.abs(scaleFactor(4, 16, "sublinear") - 2.828) < 0.001);
  assert.equal(scaleFactor(4, 40, "fixed"), 1);
  const forTen = scaleIngredients(curry, 10);
  assert.deepEqual(forTen.map((line) => [line.label.en, line.quantity]), [["chicken, curry cut", 1500], ["coconut milk, thick", 500], ["big onion", 2.5], ["salt", 12], ["pandan leaf", 1], ["egg, for garnish", 2.5]]);
  assert.equal(forTen[0]!.base_quantity, 600);
  const forOne = scaleIngredients(curry, 1);
  assert.deepEqual(forOne.map((line) => line.quantity), [150, 50, 0.5, 2, 1, 0.5], "salt for one is 6 × 0.25^0.75 = 2.1 g, rounded to the half gram");
});

test("kitchen rounding steps by magnitude and never returns zero", () => {
  assert.equal(roundKitchen(0.3, "g"), 0.25);
  assert.equal(roundKitchen(0.05, "g"), 0.25);
  assert.equal(roundKitchen(7.3, "g"), 7.5);
  assert.equal(roundKitchen(63.4, "ml"), 63);
  assert.equal(roundKitchen(612, "g"), 610);
  assert.equal(roundKitchen(1234, "g"), 1230);
  assert.equal(roundKitchen(0.1, "piece"), 0.5);
  assert.equal(roundKitchen(2.3, "piece"), 2.5);
});

test("nutrition per serving comes from edible grams and leaves optional and unknown lines out", () => {
  const four = recipeNutrition(curry, lookup);
  // chicken 600 × 0.68 = 408 g edible → 877 kcal; coconut milk 200 g → 380; onion 120 × 0.9 = 108 g → 43; salt 0.
  assert.equal(four.total.kcal, 1300);
  assert.equal(four.per_serving.kcal, 325);
  assert.equal(four.per_serving.protein_g, 20.3);
  assert.equal(four.per_serving.sodium_mg, 570 + 0);
  assert.deepEqual(four.coverage, { counted: 5, with_nutrition: 4, missing: ["pandan leaf"] });
  assert.equal(four.edible_g_per_serving, 181, "408 + 200 + 108 + 6 g of salt, over four");
  const ten = recipeNutrition(curry, lookup, 10);
  assert.equal(ten.per_serving.kcal, 325, "per-serving figures hold when the headcount changes");
  assert.equal(ten.total.kcal, 3251, "the onion rounds to 2.5 pieces for ten, so the total is not an exact multiple");
});

test("cost per serving converts purchased amounts to the priced unit and flags what is unpriced or stale", () => {
  const prices = new Map<string, IngredientPrice>([
    ["product_chicken", { price: 1300, unit: "kg", seller: "Keells", observed_on: "2026-09-12", stale: false }],
    ["product_big_onion", { price: 280, unit: "kg", seller: "Dambulla", observed_on: "2026-09-10", stale: false }],
    ["product_salt", { price: 90, unit: "kg", seller: "Cargills", observed_on: "2026-08-01", stale: true }],
  ]);
  const cost = recipeCost(curry, lookup, (id) => prices.get(id));
  assert.equal(cost.lines.length, 3);
  assert.equal(cost.lines[0]!.cost, 780);
  assert.equal(cost.lines[1]!.cost, 33.6, "one onion is 120 g at Rs 280 a kilo");
  assert.deepEqual([cost.lines[1]!.amount, cost.lines[1]!.price_unit, cost.lines[1]!.unit_price], [0.12, "kg", 280], "the breakdown names the amount in the priced unit and the unit price");
  assert.equal(cost.lines[2]!.cost, 0.54);
  assert.equal(cost.total, 814.14);
  assert.equal(cost.per_serving, 203.54);
  assert.deepEqual(cost.unpriced, ["coconut milk, thick", "pandan leaf"]);
  assert.equal(cost.estimated, true);
  assert.equal(quantityInPricedUnit({ quantity: 2, unit: "piece" }, "kg", registry.get("product_egg")), 0.11);
  assert.equal(quantityInPricedUnit({ quantity: 110, unit: "g" }, "piece", registry.get("product_egg")), 2);
  assert.equal(quantityInPricedUnit({ quantity: 1, unit: "piece" }, "kg", registry.get("product_salt")), null, "a piece without a known weight cannot be priced by the kilo");
});

test("deep-frying oil counts only its absorbed share towards calories and cost, but is bought in full", () => {
  const oil = ingredientSchema.parse({ id: "product_coconut_oil", names: { en: "Coconut oil" }, group: "fat_oil", state: "processed", edible_portion: 1, density_g_per_ml: 0.92, nutrition: { kcal: 862, protein_g: 0, fat_g: 100, carb_g: 0 }, basis: "USDA", confidence: "high" });
  const fried: Recipe = recipeSchema.parse({
    id: "dish_kavum",
    base_servings: 4,
    serving: { role: "sweet", portion_g: 70 },
    yield_g: 280,
    ingredients: [
      { ref: "product_big_onion", label: { en: "big onion" }, quantity: 200, unit: "g" },
      { ref: "product_coconut_oil", label: { en: "coconut oil" }, quantity: 400, unit: "ml", preparation: { en: "for deep frying" }, part: "frying" },
    ],
    steps: { en: [{ text: "Fry." }] },
    times: { prep_minutes: 5, cook_minutes: 20 },
  });
  const find = (id: string) => (id === "product_coconut_oil" ? oil : registry.get(id));
  const nutrition = recipeNutrition(fried, find);
  // 400 ml × 0.92 = 368 g of oil, 15% absorbed = 55.2 g → 476 kcal; onion 200 × 0.9 × 0.4 = 72 kcal.
  assert.equal(nutrition.total.kcal, 548);
  const cost = recipeCost(fried, find, (id) => (id === "product_coconut_oil" ? { price: 1000, unit: "l", seller: "Keells", observed_on: "2026-09-12", stale: false } : undefined));
  assert.equal(cost.lines[0]!.cost, 60, "0.4 l at Rs 1,000 a litre, 15% of it");
  assert.equal(scaleIngredients(fried, 4)[1]!.quantity, 400, "the shopping amount stays the full bottle");
});

test("computed tags follow per-serving thresholds by role", () => {
  assert.deepEqual(computedTags({ kcal: 120, protein_g: 14, fat_g: 3, carb_g: 8, fibre_g: 5, sugar_g: 1, sodium_mg: 300 }, "side"), ["low_calorie", "high_protein", "low_carb", "low_fat", "high_fibre"]);
  assert.deepEqual(computedTags({ kcal: 620, protein_g: 12, fat_g: 30, carb_g: 70, fibre_g: 2, sugar_g: 35, sodium_mg: 900 }, "main"), ["high_sugar", "high_sodium"]);
  assert.deepEqual(computedTags({ kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fibre_g: null, sugar_g: null, sodium_mg: null }, "drink"), ["low_calorie", "low_carb", "low_fat"]);
});

test("household measures pick the largest spoon or cup that lands near a quarter", () => {
  const milk = registry.get("pantry_coconut_milk");
  assert.equal(householdMeasure(240, milk), "1 cup");
  assert.equal(householdMeasure(60, milk), "¼ cup");
  assert.equal(householdMeasure(45, milk), "3 tbsp");
  assert.equal(householdMeasure(7, milk), "½ tbsp");
  assert.equal(householdMeasure(6, registry.get("product_salt")), "1 tsp");
  assert.equal(householdMeasure(6, registry.get("product_chicken")), null);
  assert.equal(householdMeasure(6, undefined), null);
});

test("a menu scales each recipe to its servings, merges the shopping list, and totals per person", () => {
  const sambol: Recipe = recipeSchema.parse({
    id: "dish_lunu_miris",
    base_servings: 4,
    serving: { role: "condiment", portion_g: 30 },
    yield_g: 120,
    ingredients: [
      { ref: "product_big_onion", label: { en: "big onion" }, quantity: 120, unit: "g" },
      { ref: "product_salt", label: { en: "salt" }, quantity: 3, unit: "g", scaling: "sublinear" },
    ],
    steps: { en: [{ text: "Pound everything." }] },
    times: { prep_minutes: 10, cook_minutes: 0 },
  });
  const menu = menuSchema.parse({ id: "menu_1", name: "Sunday lunch", people: 8, items: [{ recipe_id: "dish_chicken_curry" }, { recipe_id: "dish_lunu_miris", servings: 4 }], created_at: "2026-09-13T06:00:00.000Z" });
  const recipes = new Map([[curry.id, curry], [sambol.id, sambol]]);
  const totals = menuTotals(menu, (id) => recipes.get(id), lookup, (id) => (id === "product_chicken" ? { price: 1000, unit: "kg", seller: "Keells", observed_on: "2026-09-12", stale: false } : undefined));
  assert.deepEqual(totals.items.map((item) => [item.recipe_id, item.servings]), [["dish_chicken_curry", 8], ["dish_lunu_miris", 4]]);
  assert.equal(totals.total.nutrition.kcal, 2644, "curry doubled (2600.8) plus the sambol as written (43.2), summed before rounding");
  assert.equal(totals.per_person.nutrition.kcal, Math.round(2644 / 8));
  assert.equal(totals.total.cost, 1200);
  assert.equal(totals.per_person.cost, 150);
  assert.equal(totals.total.estimated, true);
  const onion = totals.shopping.find((line) => line.ref === "product_big_onion" && line.unit === "g");
  assert.equal(onion?.quantity, 120, "grams and pieces of the same ingredient stay separate lines");
  assert.equal(onion?.label, "Big onion", "a product line takes the registry's name, whatever the recipe called it");
  const chicken = totals.shopping.find((line) => line.ref === "product_chicken");
  assert.deepEqual([chicken?.cost, chicken?.unit_price, chicken?.price_unit, chicken?.sellers], [1200, 1000, "kg", ["Keells"]], "a shopping line carries what its summed amount costs and where");
  assert.equal(totals.shopping.find((line) => line.ref === "pantry_coconut_milk")?.cost, null);
  assert.deepEqual(totals.shopping.find((line) => line.ref === "product_salt")?.recipes, ["dish_chicken_curry", "dish_lunu_miris"]);
  assert.equal(totals.shopping.find((line) => line.ref === "product_salt")?.quantity, roundKitchen(6 * 2 ** 0.75 + 3, "g"));
});

test("schemas refuse mismatched step counts and duplicate ingredients; the energy check is an aid", () => {
  const short = recipeSchema.safeParse({ ...curry, steps: { en: curry.steps.en, si: [{ text: "one" }], ta: null } });
  assert.equal(short.success, false);
  assert.equal(Math.round(atwaterEnergy({ kcal: 0, protein_g: 18.6, fat_g: 15.1, carb_g: 0, fibre_g: null, sugar_g: null, sodium_mg: null })), 210);
  assert.equal(Math.round(atwaterEnergy({ kcal: 0, protein_g: 10, fat_g: 0, carb_g: 50, fibre_g: 20, sugar_g: null, sodium_mg: null })), 200, "fibre counts 2 kcal a gram");
  const duplicate = ingredientRegistrySchema.safeParse({ schema_version: "1.0.0", reviewed_by: "tests", reviewed_at: "2026-09-13", ingredients: [registry.get("product_chicken"), registry.get("product_chicken")] });
  assert.equal(duplicate.success, false);
  assert.equal(ingredientRegistrySchema.safeParse({ schema_version: "1.0.0", reviewed_by: "tests", reviewed_at: "2026-09-13", ingredients: [{ ...registry.get("product_chicken"), nutrition: null, edible_portion: 0 }] }).success, true, "unknown nutrition and a zero edible portion are allowed");
});
