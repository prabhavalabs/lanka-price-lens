import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import { dishCatalogueSchema, recipeReferencesSchema, type Dish, type DishCatalogue, type RecipeReferences } from "@lanka-pricelens/shared";

/**
 * The recipe corpus as the API serves it: the reviewed dish catalogue and the
 * reference index, read once from the recipes directory, plus what the warehouse
 * can price today for each dish's key ingredients. Recipes with quantities and
 * method text arrive in a later layer; the catalogue is the vocabulary they share.
 */

export type RecipeStore = { catalogue: DishCatalogue; references: RecipeReferences; directory: string; loadedAt: string };

export function readRecipeStore(directory: string): RecipeStore {
  const catalogue = dishCatalogueSchema.parse(JSON.parse(readFileSync(resolve(directory, "catalogue.json"), "utf8")));
  const referencesPath = resolve(directory, "references.json");
  const references = existsSync(referencesPath)
    ? recipeReferencesSchema.parse(JSON.parse(readFileSync(referencesPath, "utf8")))
    : recipeReferencesSchema.parse({ schema_version: "1.0.0", reviewed_at: catalogue.reviewed_at });
  return { catalogue, references, directory, loadedAt: new Date().toISOString() };
}

export type DishListRequest = {
  search: string;
  category: string;
  meal: string;
  protein: string;
  diet: string;
  region: string;
  occasion: string;
  page: number;
  pageSize: number;
};

/** What the warehouse can price for a product right now: the cheapest current seller and how many sellers report it. */
export type IngredientPrice = { product_id: string; label: string; sellers: number; cheapest: number; unit: string };

export type Coverage = { priced: number; total: number };
export type DishSummary = Dish & { coverage: Coverage | null };
export type DishDetail = Dish & {
  ingredients: Array<{ product_id: string; label: string | null; price: IngredientPrice | null }>;
  pairs: Array<{ id: string; label: string }>;
  coverage: Coverage | null;
};
export type RecipeOverview = {
  dishes: number;
  by_category: Array<{ category: string; dishes: number }>;
  by_meal: Array<{ meal: string; dishes: number }>;
  coverage: { products: number; priced: number; dishes_fully_priced: number } | null;
  /** Ingredients the catalogue names that the price vocabulary does not carry, most used first: the pantry mapping backlog. */
  unpriced_ingredients: Array<{ ingredient: string; dishes: number }>;
  references: { channels: number; blogs: number; institutional: number };
  reviewed_at: string;
};

export function listDishes(store: RecipeStore, request: DishListRequest, priced: Set<string> | null): { items: DishSummary[]; page: number; pageSize: number; total: number; pages: number } {
  const needle = request.search.trim().toLowerCase();
  const tokens = needle.split(/\s+/u).filter(Boolean);
  const matches = store.catalogue.dishes.filter((dish) => {
    if (request.category && dish.category !== request.category) return false;
    if (request.meal && !(dish.meal_slots as string[]).includes(request.meal)) return false;
    if (request.protein && !(dish.protein_source as string[]).includes(request.protein)) return false;
    if (request.diet && !(dish.diet as string[]).includes(request.diet)) return false;
    if (request.region && dish.region !== request.region) return false;
    if (request.occasion && !(dish.occasions as string[]).includes(request.occasion)) return false;
    if (!tokens.length) return true;
    const haystack = [dish.id, dish.names.en, dish.names.si, dish.names.si_latn, dish.names.ta, dish.names.ta_latn, ...dish.variants, ...dish.other_ingredients, ...dish.key_ingredients]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
  // An exact name match floats to the top; then everyday dishes before occasional ones; then by name.
  const exact = (dish: Dish) => (needle && dish.names.en.toLowerCase() === needle ? 0 : 1);
  matches.sort((left, right) => exact(left) - exact(right) || left.popularity - right.popularity || left.names.en.localeCompare(right.names.en));
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / request.pageSize));
  const page = Math.min(Math.max(1, request.page), pages);
  const items = matches.slice((page - 1) * request.pageSize, page * request.pageSize).map((dish) => ({ ...dish, coverage: coverageOf(dish, priced) }));
  return { items, page, pageSize: request.pageSize, total, pages };
}

export function dishDetail(store: RecipeStore, dishId: string, labels: Map<string, string>, prices: Map<string, IngredientPrice> | null): DishDetail | null {
  const dish = store.catalogue.dishes.find((candidate) => candidate.id === dishId);
  if (!dish) return null;
  const byId = new Map(store.catalogue.dishes.map((candidate) => [candidate.id, candidate]));
  return {
    ...dish,
    ingredients: dish.key_ingredients.map((product_id) => ({ product_id, label: labels.get(product_id) ?? prices?.get(product_id)?.label ?? null, price: prices?.get(product_id) ?? null })),
    pairs: dish.pairs_with.map((id) => ({ id, label: byId.get(id)?.names.en ?? id })),
    coverage: coverageOf(dish, prices ? new Set(prices.keys()) : null),
  };
}

export function recipeOverview(store: RecipeStore, priced: Set<string> | null): RecipeOverview {
  const dishes = store.catalogue.dishes;
  const tally = (values: string[]): Array<{ key: string; dishes: number }> => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return [...counts.entries()].map(([key, total]) => ({ key, dishes: total })).sort((left, right) => right.dishes - left.dishes || left.key.localeCompare(right.key));
  };
  const products = new Set(dishes.flatMap((dish) => dish.key_ingredients));
  return {
    dishes: dishes.length,
    by_category: tally(dishes.map((dish) => dish.category)).map(({ key, dishes: total }) => ({ category: key, dishes: total })),
    by_meal: tally(dishes.flatMap((dish) => dish.meal_slots)).map(({ key, dishes: total }) => ({ meal: key, dishes: total })),
    coverage: priced
      ? { products: products.size, priced: [...products].filter((id) => priced.has(id)).length, dishes_fully_priced: dishes.filter((dish) => dish.key_ingredients.length > 0 && dish.key_ingredients.every((id) => priced.has(id))).length }
      : null,
    unpriced_ingredients: tally(dishes.flatMap((dish) => [...new Set(dish.other_ingredients.map((ingredient) => ingredient.trim().toLowerCase()))])).slice(0, 40).map(({ key, dishes: total }) => ({ ingredient: key, dishes: total })),
    references: { channels: store.references.channels.length, blogs: store.references.blogs.length, institutional: store.references.institutional.length },
    reviewed_at: store.catalogue.reviewed_at,
  };
}

/** The cheapest current price per product across every seller, in the product's most common unit. */
export async function ingredientPrices(client: WarehouseClient, productIds: string[]): Promise<Map<string, IngredientPrice>> {
  if (!productIds.length) return new Map();
  const rows = await client.query<{ product_id: string; label: string; sellers: string; cheapest: string; unit: string }>(
    `SELECT item.product_id, product.label_en AS label, COUNT(DISTINCT (latest.market_id, latest.price_type))::TEXT AS sellers,
            MIN(latest.mid_minor)::TEXT AS cheapest, MODE() WITHIN GROUP (ORDER BY latest.normalized_unit) AS unit
     FROM latest_item_price latest JOIN item ON item.id = latest.item_id JOIN product ON product.id = item.product_id
     WHERE item.product_id = ANY($1::text[])
     GROUP BY item.product_id, product.label_en`,
    [productIds],
  );
  return new Map(rows.map((row) => [row.product_id, { product_id: row.product_id, label: row.label, sellers: Number(row.sellers), cheapest: Number(row.cheapest) / 100, unit: row.unit }]));
}

/** Every product the warehouse prices today; the catalogue's coverage is measured against it. */
export async function pricedProducts(client: WarehouseClient): Promise<Set<string>> {
  const rows = await client.query<{ product_id: string }>("SELECT DISTINCT item.product_id FROM latest_item_price latest JOIN item ON item.id = latest.item_id WHERE item.product_id IS NOT NULL");
  return new Set(rows.map((row) => row.product_id));
}

export async function productLabels(client: WarehouseClient, productIds: string[]): Promise<Map<string, string>> {
  if (!productIds.length) return new Map();
  const rows = await client.query<{ id: string; label_en: string }>("SELECT id, label_en FROM product WHERE id = ANY($1::text[])", [productIds]);
  return new Map(rows.map((row) => [row.id, row.label_en]));
}

function coverageOf(dish: Dish, priced: Set<string> | null): Coverage | null {
  if (!priced) return null;
  return { priced: dish.key_ingredients.filter((id) => priced.has(id)).length, total: dish.key_ingredients.length };
}
