import { isPricedIngredient, type Ingredient, type Menu, type Nutrition, type Recipe, type RecipeIngredient, type RecipeTag } from "./recipes.ts";

/**
 * Everything a recipe page or a menu shows is computed here from the recipe's facts: the
 * ingredient list scaled to a headcount and rounded to kitchen amounts, nutrition per serving
 * from the ingredient registry, cost per serving from today's prices, and the totals of a menu.
 * Pure functions, no I/O, so the site and the API share one arithmetic.
 */

export type IngredientLookup = (id: string) => Ingredient | undefined;

/** One price the warehouse offers for an ingredient: what a unit costs at a seller today. */
export type IngredientPrice = {
  /** Rupees per `unit`. */
  price: number;
  unit: "kg" | "l" | "piece" | "bunch";
  seller: string;
  observed_on: string;
  /** The price is older than the source's cadence allows; the cost is marked estimated. */
  stale: boolean;
};
/** Finds a price for an ingredient line; the line is passed so the caller can pick the unit the recipe can convert to. */
export type PriceLookup = (id: string, line: Pick<RecipeIngredient, "quantity" | "unit">) => IngredientPrice | undefined;

/** Sublinear ingredients (salt, tempering oil, whole spices) grow with this power of the headcount ratio. */
export const sublinearExponent = 0.75;

export function scaleFactor(baseServings: number, servings: number, scaling: RecipeIngredient["scaling"]): number {
  const ratio = servings / baseServings;
  if (scaling === "fixed") return 1;
  if (scaling === "sublinear") return ratio ** sublinearExponent;
  return ratio;
}

/** Rounds to an amount a cook can measure: finer for small amounts, coarser for large ones; never zero. */
export function roundKitchen(value: number, unit: RecipeIngredient["unit"]): number {
  if (unit === "piece") return Math.max(0.5, Math.round(value * 2) / 2);
  const step = value < 1 ? 0.25 : value < 10 ? 0.5 : value < 100 ? 1 : value < 1000 ? 5 : 10;
  return Math.max(step, Math.round(value / step) * step);
}

export type ScaledIngredient = RecipeIngredient & { quantity: number; base_quantity: number };

export function scaleIngredients(recipe: Recipe, servings: number): ScaledIngredient[] {
  return recipe.ingredients.map((ingredient) => ({
    ...ingredient,
    base_quantity: ingredient.quantity,
    quantity: roundKitchen(ingredient.quantity * scaleFactor(recipe.base_servings, servings, ingredient.scaling), ingredient.unit),
  }));
}

/** The purchased weight of an ingredient line in grams, or null when a piece has no known weight. */
export function gramsOf(ingredient: Pick<RecipeIngredient, "quantity" | "unit">, entry: Ingredient | undefined): number | null {
  if (ingredient.unit === "g") return ingredient.quantity;
  if (ingredient.unit === "ml") return ingredient.quantity * (entry?.density_g_per_ml ?? 1);
  const piece = entry?.measures.piece_g;
  return piece ? ingredient.quantity * piece : null;
}

export const emptyNutrition: Nutrition = { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fibre_g: 0, sugar_g: 0, sodium_mg: 0 };

function addNutrition(total: Nutrition, part: Nutrition, factor: number): Nutrition {
  return {
    kcal: total.kcal + part.kcal * factor,
    protein_g: total.protein_g + part.protein_g * factor,
    fat_g: total.fat_g + part.fat_g * factor,
    carb_g: total.carb_g + part.carb_g * factor,
    fibre_g: (total.fibre_g ?? 0) + (part.fibre_g ?? 0) * factor,
    sugar_g: (total.sugar_g ?? 0) + (part.sugar_g ?? 0) * factor,
    sodium_mg: (total.sodium_mg ?? 0) + (part.sodium_mg ?? 0) * factor,
  };
}

function divideNutrition(total: Nutrition, by: number): Nutrition {
  return {
    kcal: total.kcal / by,
    protein_g: total.protein_g / by,
    fat_g: total.fat_g / by,
    carb_g: total.carb_g / by,
    fibre_g: (total.fibre_g ?? 0) / by,
    sugar_g: (total.sugar_g ?? 0) / by,
    sodium_mg: (total.sodium_mg ?? 0) / by,
  };
}

function roundNutrition(value: Nutrition): Nutrition {
  const one = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
  return { kcal: Math.round(value.kcal), protein_g: one(value.protein_g) ?? 0, fat_g: one(value.fat_g) ?? 0, carb_g: one(value.carb_g) ?? 0, fibre_g: one(value.fibre_g), sugar_g: one(value.sugar_g), sodium_mg: value.sodium_mg === null ? null : Math.round(value.sodium_mg) };
}

export type RecipeNutrition = {
  per_serving: Nutrition;
  total: Nutrition;
  servings: number;
  /** Ingredient lines that carry nutrition against all counted lines (optional lines are not counted). */
  coverage: { counted: number; with_nutrition: number; missing: string[] };
  /** Grams of edible food per serving, before cooking. */
  edible_g_per_serving: number;
};

/** Sums the registry's figures over the recipe's ingredients; optional ingredients are left out. */
export function recipeNutrition(recipe: Recipe, lookup: IngredientLookup, servings = recipe.base_servings): RecipeNutrition {
  const raw = rawNutrition(recipe, lookup, servings);
  return { ...raw, per_serving: roundNutrition(divideNutrition(raw.total, servings)), total: roundNutrition(raw.total) };
}

function rawNutrition(recipe: Recipe, lookup: IngredientLookup, servings: number): RecipeNutrition {
  let total = emptyNutrition;
  let edible = 0;
  let counted = 0;
  let withNutrition = 0;
  const missing: string[] = [];
  for (const ingredient of scaleIngredients(recipe, servings)) {
    if (ingredient.optional) continue;
    counted += 1;
    const entry = ingredient.ref ? lookup(ingredient.ref) : undefined;
    const grams = gramsOf(ingredient, entry);
    if (!entry || !entry.nutrition || grams === null) {
      missing.push(ingredient.label.en);
      continue;
    }
    withNutrition += 1;
    const edibleGrams = grams * entry.edible_portion;
    edible += edibleGrams;
    total = addNutrition(total, entry.nutrition, edibleGrams / 100);
  }
  return { per_serving: divideNutrition(total, servings), total, servings, coverage: { counted, with_nutrition: withNutrition, missing }, edible_g_per_serving: Math.round(edible / servings) };
}

export type IngredientCost = { ref: string; label: string; quantity: number; unit: RecipeIngredient["unit"]; cost: number; seller: string; observed_on: string; stale: boolean };

export type RecipeCost = {
  total: number;
  per_serving: number;
  servings: number;
  lines: IngredientCost[];
  /** Ingredient lines with no price today (pantry items, or products with no observation). */
  unpriced: string[];
  /** True when something is unpriced or a price is stale: the figure is a floor, not the bill. */
  estimated: boolean;
};

/** Converts a purchased quantity to the unit a price is quoted in, or null when the registry cannot bridge them. */
export function quantityInPricedUnit(ingredient: Pick<RecipeIngredient, "quantity" | "unit">, priced: IngredientPrice["unit"], entry: Ingredient | undefined): number | null {
  if (priced === "kg" || priced === "l") {
    const grams = gramsOf(ingredient, entry);
    if (grams === null) return null;
    // A litre of most kitchen liquids is close to a kilogram; density corrects the rest.
    return priced === "kg" ? grams / 1000 : grams / (entry?.density_g_per_ml ?? 1) / 1000;
  }
  if (priced === "piece") {
    if (ingredient.unit === "piece") return ingredient.quantity;
    const grams = gramsOf(ingredient, entry);
    return grams !== null && entry?.measures.piece_g ? grams / entry.measures.piece_g : null;
  }
  const grams = gramsOf(ingredient, entry);
  return grams !== null && entry?.measures.bunch_g ? grams / entry.measures.bunch_g : null;
}

export function recipeCost(recipe: Recipe, lookup: IngredientLookup, prices: PriceLookup, servings = recipe.base_servings): RecipeCost {
  const lines: IngredientCost[] = [];
  const unpriced: string[] = [];
  let total = 0;
  let stale = false;
  for (const ingredient of scaleIngredients(recipe, servings)) {
    if (ingredient.optional) continue;
    const entry = ingredient.ref ? lookup(ingredient.ref) : undefined;
    const price = ingredient.ref && isPricedIngredient(ingredient.ref) ? prices(ingredient.ref, ingredient) : undefined;
    const amount = price ? quantityInPricedUnit(ingredient, price.unit, entry) : null;
    if (!price || amount === null || !ingredient.ref) {
      unpriced.push(ingredient.label.en);
      continue;
    }
    const cost = Math.round(amount * price.price * 100) / 100;
    stale = stale || price.stale;
    total += cost;
    lines.push({ ref: ingredient.ref, label: ingredient.label.en, quantity: ingredient.quantity, unit: ingredient.unit, cost, seller: price.seller, observed_on: price.observed_on, stale: price.stale });
  }
  return { total: Math.round(total * 100) / 100, per_serving: Math.round((total / servings) * 100) / 100, servings, lines, unpriced, estimated: stale || unpriced.length > 0 };
}

/**
 * Tags a recipe earns from its numbers per serving, so a query for "light" or "high protein"
 * needs no curation. Thresholds are per serving in the dish's role: a curry eaten with rice is a
 * side, not a meal, so its calorie bar sits lower than a one-plate main's.
 */
export function computedTags(nutrition: Nutrition, role: Recipe["serving"]["role"]): RecipeTag[] {
  const tags: RecipeTag[] = [];
  const proteinShare = nutrition.kcal > 0 ? (nutrition.protein_g * 4) / nutrition.kcal : 0;
  const fatShare = nutrition.kcal > 0 ? (nutrition.fat_g * 9) / nutrition.kcal : 0;
  const mealLike = role === "main" || role === "staple" || role === "breakfast";
  if (nutrition.kcal <= (mealLike ? 350 : 150)) tags.push("low_calorie");
  if (nutrition.protein_g >= (mealLike ? 20 : 12) || (proteinShare >= 0.3 && nutrition.protein_g >= 6)) tags.push("high_protein");
  if (nutrition.carb_g <= (mealLike ? 30 : 12)) tags.push("low_carb");
  if (fatShare <= 0.25) tags.push("low_fat");
  if ((nutrition.fibre_g ?? 0) >= (mealLike ? 8 : 4)) tags.push("high_fibre");
  if ((nutrition.sugar_g ?? 0) >= 20) tags.push("high_sugar");
  if ((nutrition.sodium_mg ?? 0) >= 800) tags.push("high_sodium");
  return tags;
}

/** The household measure closest to a gram amount, when the registry knows the ingredient's spoon and cup weights. */
export function householdMeasure(grams: number, entry: Ingredient | undefined): string | null {
  if (!entry) return null;
  const candidates: Array<[string, number | null]> = [["cup", entry.measures.cup_g], ["tbsp", entry.measures.tbsp_g], ["tsp", entry.measures.tsp_g]];
  for (const [name, weight] of candidates) {
    if (!weight) continue;
    const count = grams / weight;
    if (count < 0.25) continue;
    const quarter = Math.round(count * 4) / 4;
    if (quarter === 0 || Math.abs(quarter - count) / count > 0.12) continue;
    if (name !== "cup" && quarter > 4) continue;
    return `${fraction(quarter)} ${name}`;
  }
  return null;
}

function fraction(value: number): string {
  const whole = Math.floor(value);
  const rest = Math.round((value - whole) * 4);
  const glyph = ["", "¼", "½", "¾"][rest] ?? "";
  if (rest === 4) return String(whole + 1);
  return whole === 0 ? glyph : `${whole}${glyph}`;
}

export type MenuLine = { ref: string | null; label: string; unit: RecipeIngredient["unit"]; quantity: number; recipes: string[] };

export type MenuTotals = {
  people: number;
  items: Array<{ recipe_id: string; servings: number; nutrition: RecipeNutrition; cost: RecipeCost | null }>;
  /** Everything to buy, one line per ingredient, summed across recipes. */
  shopping: MenuLine[];
  per_person: { nutrition: Nutrition; cost: number | null };
  total: { nutrition: Nutrition; cost: number | null; estimated: boolean };
};

/** Scales every recipe in a menu to its servings, sums nutrition and cost, and merges the shopping list. */
export function menuTotals(menu: Menu, recipes: (id: string) => Recipe | undefined, lookup: IngredientLookup, prices?: PriceLookup): MenuTotals {
  const items: MenuTotals["items"] = [];
  const shopping = new Map<string, MenuLine>();
  let nutrition = emptyNutrition;
  let cost = 0;
  let anyCost = false;
  let estimated = false;
  for (const item of menu.items) {
    const recipe = recipes(item.recipe_id);
    if (!recipe) continue;
    const servings = item.servings ?? menu.people;
    const raw = rawNutrition(recipe, lookup, servings);
    const recipeCosts = prices ? recipeCost(recipe, lookup, prices, servings) : null;
    items.push({ recipe_id: recipe.id, servings, nutrition: { ...raw, per_serving: roundNutrition(raw.per_serving), total: roundNutrition(raw.total) }, cost: recipeCosts });
    nutrition = addNutrition(nutrition, raw.total, 1);
    if (recipeCosts) {
      anyCost = true;
      cost += recipeCosts.total;
      estimated = estimated || recipeCosts.estimated;
    }
    for (const ingredient of scaleIngredients(recipe, servings)) {
      if (ingredient.optional) continue;
      const key = `${ingredient.ref ?? ingredient.label.en.toLowerCase()}|${ingredient.unit}`;
      const line = shopping.get(key) ?? { ref: ingredient.ref, label: ingredient.label.en, unit: ingredient.unit, quantity: 0, recipes: [] };
      line.quantity += ingredient.quantity;
      if (!line.recipes.includes(recipe.id)) line.recipes.push(recipe.id);
      shopping.set(key, line);
    }
  }
  const list = [...shopping.values()].map((line) => ({ ...line, quantity: roundKitchen(line.quantity, line.unit) })).sort((left, right) => left.label.localeCompare(right.label));
  return {
    people: menu.people,
    items,
    shopping: list,
    per_person: { nutrition: roundNutrition(divideNutrition(nutrition, menu.people)), cost: anyCost ? Math.round((cost / menu.people) * 100) / 100 : null },
    total: { nutrition: roundNutrition(nutrition), cost: anyCost ? Math.round(cost * 100) / 100 : null, estimated },
  };
}
