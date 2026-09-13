import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import {
  computedTags,
  householdMeasure,
  menuSchema,
  menuTotals,
  quantityInPricedUnit,
  recipeCost,
  recipeNutrition,
  recipeTags,
  scaleIngredients,
  type Dish,
  type Ingredient,
  type IngredientPrice,
  type Language,
  type Menu,
  type MenuTotals,
  type Nutrition,
  type PriceLookup,
  type Recipe,
  type RecipeCost,
  type RecipeIngredient,
  type RecipeNutrition,
  type RecipeTag,
  type SourceManifest,
} from "@lanka-pricelens/shared";

import { staleAfterDays } from "./explorer.ts";
import type { RecipeStore } from "./recipes.ts";

/**
 * The recipe layer as the site sees it: a recipe scaled to a headcount with its nutrition and
 * today's cost, a searchable index over every recipe's numbers, and a menu's totals. Nutrition
 * is fixed by the corpus and computed once at load; cost depends on today's prices and is
 * computed per request from the cheapest published seller in a unit the recipe can convert.
 */

export type RecipeMetrics = {
  kcal: number;
  protein_g: number;
  fat_g: number;
  carb_g: number;
  fibre_g: number | null;
  minutes: number;
  /** Curated tags plus the ones the numbers earn. */
  tags: RecipeTag[];
  role: Recipe["serving"]["role"];
  portion_g: number;
  /** How many counted ingredient lines carry nutrition. */
  coverage: RecipeNutrition["coverage"];
  languages: Language[];
};

export type RecipeIndexEntry = { dish: Dish; recipe: Recipe; metrics: RecipeMetrics };

/** Everything derivable from the corpus alone, computed once per store. */
export function buildRecipeIndex(store: RecipeStore): Map<string, RecipeIndexEntry> {
  const index = new Map<string, RecipeIndexEntry>();
  const lookup = (id: string) => store.registry.get(id);
  for (const dish of store.catalogue.dishes) {
    const recipe = store.recipes.get(dish.id);
    if (!recipe) continue;
    const nutrition = recipeNutrition(recipe, lookup);
    const tags = [...new Set([...recipe.tags, ...computedTags(nutrition.per_serving, recipe.serving.role)])];
    const languages: Language[] = ["en"];
    if (recipe.steps.si) languages.push("si");
    if (recipe.steps.ta) languages.push("ta");
    index.set(dish.id, {
      dish,
      recipe,
      metrics: {
        kcal: nutrition.per_serving.kcal,
        protein_g: nutrition.per_serving.protein_g,
        fat_g: nutrition.per_serving.fat_g,
        carb_g: nutrition.per_serving.carb_g,
        fibre_g: nutrition.per_serving.fibre_g,
        minutes: recipe.times.prep_minutes + recipe.times.cook_minutes + recipe.times.passive_minutes,
        tags,
        role: recipe.serving.role,
        portion_g: recipe.serving.portion_g,
        coverage: nutrition.coverage,
        languages,
      },
    });
  }
  return index;
}

/** One seller's price for a product in one unit, as the warehouse has it today. */
export type PriceOption = IngredientPrice & { product_id: string };

/**
 * The cheapest published price per product and unit, fresh sellers first. A product priced by
 * the kilo at one store and by the piece at another keeps both, so a recipe line in grams or in
 * pieces can each find a price it can convert.
 */
export async function priceOptions(client: WarehouseClient, sources: SourceManifest[], productIds: string[], today = new Date()): Promise<Map<string, PriceOption[]>> {
  const ids = [...new Set(productIds)];
  const sourceIds = sources.map((source) => source.id);
  if (!ids.length || !sourceIds.length) return new Map();
  const rows = await client.query<{ product_id: string; unit: string; mid: string; seller: string; observed_on: string; cadence: string | null }>(
    `SELECT item.product_id, latest.normalized_unit AS unit, MIN(latest.mid_minor)::TEXT AS mid, market.label_en AS seller, MAX(latest.observed_on)::TEXT AS observed_on, source.cadence
     FROM latest_item_price latest
     JOIN item ON item.id = latest.item_id AND item.status = 'active'
     JOIN market ON market.id = latest.market_id
     JOIN source ON source.id = latest.source_id
     WHERE item.product_id = ANY($1::text[]) AND latest.source_id = ANY($2::text[])
     GROUP BY item.product_id, latest.normalized_unit, market.label_en, source.cadence`,
    [ids, sourceIds],
  );
  const day = today.toISOString().slice(0, 10);
  const options = new Map<string, PriceOption[]>();
  for (const row of rows) {
    const unit = normalisePricedUnit(row.unit);
    if (!unit) continue;
    const age = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${row.observed_on}T00:00:00Z`)) / 86_400_000);
    if (age > maxPriceAgeDays) continue;
    const option: PriceOption = { product_id: row.product_id, price: Number(row.mid) / 100, unit, seller: row.seller, observed_on: row.observed_on, stale: age > staleAfterDays(row.cadence ?? undefined) };
    options.set(row.product_id, [...(options.get(row.product_id) ?? []), option]);
  }
  // Cheapest first, but a fresh price beats a stale one at any price.
  for (const list of options.values()) list.sort((left, right) => Number(left.stale) - Number(right.stale) || left.price - right.price);
  return options;
}

function normalisePricedUnit(unit: string): IngredientPrice["unit"] | null {
  if (unit === "kg" || unit === "l" || unit === "piece" || unit === "bunch") return unit;
  if (unit === "fruit") return "piece";
  return null;
}

/** A price older than this is not a price any more, stale flag or not; it never enters a cost. */
export const maxPriceAgeDays = 90;

/**
 * Below this piece weight a "piece" on a shelf is a packet, not the thing the recipe counts (a
 * sprig of curry leaves, one green chilli, a cardamom pod), so such lines are priced by weight.
 */
export const countedPieceGrams = 20;

/**
 * A lookup that picks, per ingredient line, the cheapest option in a unit the registry can
 * convert the line to. Weight prices come first; a per-piece price is used only for things
 * genuinely sold and counted whole (eggs, coconuts, limes), never for a packet of leaves.
 */
export function priceLookupFor(options: Map<string, PriceOption[]>, registry: Map<string, Ingredient>): PriceLookup {
  return (id, line) => {
    const entry = registry.get(id);
    const candidates = options.get(id) ?? [];
    const byWeight = candidates.filter((option) => option.unit === "kg" || option.unit === "l");
    const counted = (entry?.measures.piece_g ?? 0) >= countedPieceGrams;
    const ordered = counted ? [...candidates.filter((option) => option.unit === "piece"), ...byWeight, ...candidates.filter((option) => option.unit === "bunch")] : [...byWeight, ...candidates.filter((option) => option.unit === "bunch"), ...(line.unit === "piece" && !entry?.measures.piece_g ? candidates.filter((option) => option.unit === "piece") : [])];
    // Cheapest fresh first within the preferred unit, then the next unit; the sort within a unit comes from priceOptions.
    for (const option of ordered) {
      if (quantityInPricedUnit(line, option.unit, entry) !== null) return option;
    }
    return undefined;
  };
}

export type RecipeIngredientView = RecipeIngredient & {
  base_quantity: number;
  /** The registry's names for the ingredient, when it has an entry. */
  names: Ingredient["names"] | null;
  household: string | null;
  priced: boolean;
  nutrition_known: boolean;
};

export type RecipeView = {
  id: string;
  servings: number;
  base_servings: number;
  serving: Recipe["serving"];
  yield_g: number;
  ingredients: RecipeIngredientView[];
  steps: Recipe["steps"];
  times: Recipe["times"];
  equipment: string[];
  tips: Recipe["tips"];
  health_note: Recipe["health_note"];
  tags: RecipeTag[];
  nutrition: RecipeNutrition;
  cost: RecipeCost | null;
  review: Recipe["review"];
  review_needed: Recipe["review_needed"];
  languages: Language[];
};

/** The recipe scaled to `servings`, with nutrition per serving and, when prices are given, today's cost. */
export function recipeView(store: RecipeStore, index: Map<string, RecipeIndexEntry>, dishId: string, servings: number, prices: PriceLookup | null): RecipeView | null {
  const entry = index.get(dishId);
  if (!entry) return null;
  const { recipe, metrics } = entry;
  const lookup = (id: string) => store.registry.get(id);
  const nutrition = recipeNutrition(recipe, lookup, servings);
  const cost = prices ? recipeCost(recipe, lookup, prices, servings) : null;
  const priced = new Set(cost?.lines.map((line) => line.ref) ?? []);
  const ingredients: RecipeIngredientView[] = scaleIngredients(recipe, servings).map((line) => {
    const registryEntry = line.ref ? store.registry.get(line.ref) : undefined;
    const household = servings === recipe.base_servings && line.household ? line.household : householdMeasure(line.unit === "g" ? line.quantity : line.quantity * (line.unit === "ml" ? registryEntry?.density_g_per_ml ?? 1 : registryEntry?.measures.piece_g ?? 0), registryEntry);
    return { ...line, names: registryEntry?.names ?? null, household, priced: Boolean(line.ref && priced.has(line.ref)), nutrition_known: Boolean(registryEntry) };
  });
  return {
    id: recipe.id,
    servings,
    base_servings: recipe.base_servings,
    serving: recipe.serving,
    yield_g: Math.round((recipe.yield_g * servings) / recipe.base_servings),
    ingredients,
    steps: recipe.steps,
    times: recipe.times,
    equipment: recipe.equipment,
    tips: recipe.tips,
    health_note: recipe.health_note,
    tags: metrics.tags,
    nutrition,
    cost,
    review: recipe.review,
    review_needed: recipe.review_needed,
    languages: metrics.languages,
  };
}

export type RecipeQuery = {
  search: string;
  category: string;
  meal: string;
  protein: string;
  diet: string;
  region: string;
  occasion: string;
  /** Every listed tag must be present. */
  tags: string[];
  max_kcal: number | null;
  min_protein: number | null;
  max_carb: number | null;
  max_minutes: number | null;
  max_cost: number | null;
  sort: "relevance" | "kcal" | "protein" | "cost" | "time" | "name";
  page: number;
  pageSize: number;
};

export type RecipeQueryItem = { dish: Dish; metrics: RecipeMetrics; cost_per_serving: number | null; cost_estimated: boolean | null };

export function parseRecipeQuery(get: (name: string) => string | undefined): RecipeQuery {
  const text = (name: string, limit = 40) => (get(name) ?? "").slice(0, limit);
  const number = (name: string) => {
    const value = Number(get(name));
    return get(name) !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
  };
  const sort = get("sort");
  const known = new Set<string>(recipeTags);
  return {
    search: (get("q") ?? get("search") ?? "").slice(0, 100),
    category: text("category"),
    meal: text("meal"),
    protein: text("protein"),
    diet: text("diet"),
    region: text("region"),
    occasion: text("occasion"),
    tags: (get("tags") ?? "").split(",").map((tag) => tag.trim()).filter((tag) => known.has(tag)).slice(0, 8),
    max_kcal: number("max_kcal"),
    min_protein: number("min_protein"),
    max_carb: number("max_carb"),
    max_minutes: number("max_minutes"),
    max_cost: number("max_cost"),
    sort: sort === "kcal" || sort === "protein" || sort === "cost" || sort === "time" || sort === "name" ? sort : "relevance",
    page: Math.max(1, Number(get("page") ?? "1") || 1),
    pageSize: Math.min(60, Math.max(1, Number(get("pageSize") ?? "24") || 24)),
  };
}

/**
 * Recipes that fit a question ("under 300 kcal, high protein, quick"), ranked. Text matches any
 * name, variant, or ingredient; the numeric filters read the index; cost needs today's prices
 * and is skipped (never filtered on) when none are given.
 */
export function queryRecipes(store: RecipeStore, index: Map<string, RecipeIndexEntry>, query: RecipeQuery, prices: PriceLookup | null): { items: RecipeQueryItem[]; page: number; pageSize: number; total: number; pages: number } {
  const needle = query.search.trim().toLowerCase();
  const tokens = needle.split(/\s+/u).filter(Boolean);
  const lookup = (id: string) => store.registry.get(id);
  const items: RecipeQueryItem[] = [];
  for (const entry of index.values()) {
    const { dish, metrics, recipe } = entry;
    if (query.category && dish.category !== query.category) continue;
    if (query.meal && !(dish.meal_slots as string[]).includes(query.meal)) continue;
    if (query.protein && !(dish.protein_source as string[]).includes(query.protein)) continue;
    if (query.diet && !(dish.diet as string[]).includes(query.diet)) continue;
    if (query.region && dish.region !== query.region) continue;
    if (query.occasion && !(dish.occasions as string[]).includes(query.occasion)) continue;
    if (query.tags.length && !query.tags.every((tag) => (metrics.tags as string[]).includes(tag))) continue;
    if (query.max_kcal !== null && metrics.kcal > query.max_kcal) continue;
    if (query.min_protein !== null && metrics.protein_g < query.min_protein) continue;
    if (query.max_carb !== null && metrics.carb_g > query.max_carb) continue;
    if (query.max_minutes !== null && metrics.minutes > query.max_minutes) continue;
    if (tokens.length) {
      const haystack = [dish.id, dish.names.en, dish.names.si, dish.names.si_latn, dish.names.ta, dish.names.ta_latn, ...dish.variants, ...recipe.ingredients.map((line) => line.label.en), ...metrics.tags]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();
      if (!tokens.every((token) => haystack.includes(token))) continue;
    }
    const cost = prices ? recipeCost(recipe, lookup, prices) : null;
    // A recipe with nothing priced has no cost, not a cost of nothing.
    const priced = cost && cost.lines.length > 0 ? cost : null;
    if (query.max_cost !== null && priced && priced.per_serving > query.max_cost) continue;
    items.push({ dish, metrics, cost_per_serving: priced?.per_serving ?? null, cost_estimated: priced?.estimated ?? null });
  }
  const exact = (item: RecipeQueryItem) => (needle && item.dish.names.en.toLowerCase() === needle ? 0 : 1);
  const byName = (left: RecipeQueryItem, right: RecipeQueryItem) => left.dish.names.en.localeCompare(right.dish.names.en);
  const sorters: Record<RecipeQuery["sort"], (left: RecipeQueryItem, right: RecipeQueryItem) => number> = {
    relevance: (left, right) => exact(left) - exact(right) || left.dish.popularity - right.dish.popularity || byName(left, right),
    kcal: (left, right) => left.metrics.kcal - right.metrics.kcal || byName(left, right),
    protein: (left, right) => right.metrics.protein_g - left.metrics.protein_g || byName(left, right),
    cost: (left, right) => (left.cost_per_serving ?? Number.POSITIVE_INFINITY) - (right.cost_per_serving ?? Number.POSITIVE_INFINITY) || byName(left, right),
    time: (left, right) => left.metrics.minutes - right.metrics.minutes || byName(left, right),
    name: byName,
  };
  items.sort(sorters[query.sort]);
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pages);
  return { items: items.slice((page - 1) * query.pageSize, page * query.pageSize), page, pageSize: query.pageSize, total, pages };
}

export type MenuComputation = MenuTotals & { menu: Menu; names: Record<string, Dish["names"]>; per_person_labels: Record<string, string> };

/** Validates a menu from the site and totals it; unknown recipes are dropped and named. */
export function computeMenu(store: RecipeStore, index: Map<string, RecipeIndexEntry>, body: unknown, prices: PriceLookup | null): { ok: true; result: MenuTotals & { menu: Menu; names: Record<string, Dish["names"]>; unknown: string[] } } | { ok: false; error: string } {
  const parsed = menuSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue ? `${issue.path.join(".") || "menu"}: ${issue.message}` : "Invalid menu" };
  }
  const menu = parsed.data;
  const unknown = menu.items.map((item) => item.recipe_id).filter((id) => !index.has(id));
  const totals = menuTotals(menu, (id) => index.get(id)?.recipe, (id) => store.registry.get(id), prices ?? undefined);
  const names: Record<string, Dish["names"]> = {};
  for (const item of menu.items) {
    const dish = index.get(item.recipe_id)?.dish;
    if (dish) names[item.recipe_id] = dish.names;
  }
  return { ok: true, result: { ...totals, menu, names, unknown } };
}

/** Product ids a set of recipes needs priced, for one warehouse round trip. */
export function pricedProductIds(recipes: Recipe[]): string[] {
  return [...new Set(recipes.flatMap((recipe) => recipe.ingredients.map((line) => line.ref).filter((ref): ref is string => Boolean(ref && ref.startsWith("product_")))))];
}

export type { Nutrition };
