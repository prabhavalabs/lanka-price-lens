/** The public read API, as the site consumes it. Shapes mirror `api/src/public.ts` and `api/src/explorer.ts`. */

import type { RecipeScore } from "@lanka-pricelens/shared";

export type Group = "wholesale" | "retail_market" | "supermarket";

export type GroupPrice = { group: Group; unit: string; sellers: number; low: number; high: number; mid: number; observed_on: string; change_30d_pct: number | null };

export type ProductCard = { id: string; label: string; label_si: string | null; label_ta: string | null; category: string; comparison: "pooled" | "by_variety"; prices: GroupPrice[] };

export type Source = { id: string; name: string; publisher: string; attribution: string | null; landing_url: string; cadence: string; kind: Group | "official" };

export type Overview = { generated_at: string; as_of: string | null; sources: Source[]; products: ProductCard[] };

export type Variety = { id: string; label: string; qualifier: string; sellers: number; base: boolean };

export type Latest = { market_id: string; market_label: string; market_type: string; group: Group; price_type: string; source_id: string; observed_on: string; unit: string; low: number; high: number; mid: number; products: number; varieties: string[]; age_days: number; stale: boolean };

export type Point = { date: string; mid: number; low: number; high: number };

export type Series = { key: string; market_id: string; market_label: string; market_type: string; group: Group; price_type: string; unit: string; days: number; first: { date: string; mid: number }; last: { date: string; mid: number }; change_pct: number | null; points: Point[] };

export type Summary = { group: Group; unit: string | null; sellers: number; average: number | null; lowest: Latest | null; highest: Latest | null };

export type Detail = {
  product: { id: string; label: string; category: string; comparison: "pooled" | "by_variety"; varieties: Variety[]; sellers: number; last_day: string | null; aliases: string[] };
  selected: string[];
  range: { from: string; to: string; days: number; preset: number | null };
  bounds: { first: string | null; last: string | null };
  latest: Latest[];
  summary: Summary[];
  markup_pct: number | null;
  series: Series[];
  /** What the stores themselves mark down on this product today, cheapest first; absent from an older API. */
  offers?: Offer[];
};

export type Envelope<T> = { success: boolean; message: string; payload: T };

/** A failed request, with a message written for the person reading it and whether trying again can help. */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  readonly retryable: boolean;
  /** The API's own code for the failure (NO_MATCH, DEALS_UNAVAILABLE), when it sent one. */
  readonly code: string | null;
  constructor(status: number, message: string, retryable: boolean, code: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

/** Turns a failed response into what to tell the visitor. The API's own message wins for a plain "not found". */
export function describeFailure(status: number, message: string | null | undefined, code: string | null = null): ApiError {
  if (status === 0) return new ApiError(0, "Could not reach PriceLens. Check your connection and try again.", true);
  if (status === 404) return new ApiError(404, message ?? "Nothing here.", false, code);
  if (status === 429) return new ApiError(429, "Too many requests at once. Wait a moment and try again.", true, code);
  if (status === 502 || status === 503 || status === 504) return new ApiError(status, "PriceLens is restarting or briefly unavailable. It is usually back within a minute.", true, code);
  if (status >= 500) return new ApiError(status, "Something went wrong on our side. Try again in a moment.", true, code);
  return new ApiError(status, message ?? `Request failed (${status})`, false, code);
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
  } catch (error) {
    // A superseded request is not a failure; let the caller's query library drop it.
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw describeFailure(0, null);
  }
  const body = (await response.json().catch(() => null)) as (Envelope<T> & { code?: string }) | null;
  if (!response.ok || !body || body.success === false) throw describeFailure(response.status, body?.message, body?.code ?? null);
  return body.payload;
}

export const fetchOverview = (): Promise<Overview> => get<Overview>("/v1/public/overview");

export const fetchProduct = (id: string, days: number): Promise<Detail> => get<Detail>(`/v1/public/products/${encodeURIComponent(id)}?days=${days}`);

export type Offer = {
  id: string;
  market_id: string | null;
  market: string;
  label: string;
  category: string | null;
  pack: string;
  price: number;
  list: number;
  offer: number;
  pct: number;
  kind: "mrp" | "promo_price" | "discount" | "compare_at";
  audience: "everyone" | "members";
  offer_label: string | null;
  max_quantity: number | null;
  observed_on: string;
  product: { id: string; label: string; unit: string; list: number; offer: number } | null;
};

export type OffersPage = { generated_at: string; as_of: string | null; stores: Array<{ market_id: string; market: string; observed_on: string; offers: number }>; total: number; page: number; page_size: number; items: Offer[] };

export type OfferFilters = { market?: string; audience?: "everyone" | "members" | ""; catalogue?: boolean; q?: string; page?: number; pageSize?: number };

/** What the stores themselves mark down today; every filter is optional. */
export function fetchOffers(filters: OfferFilters = {}, signal?: AbortSignal): Promise<OffersPage> {
  const query = new URLSearchParams();
  if (filters.market) query.set("market", filters.market);
  if (filters.audience) query.set("audience", filters.audience);
  if (filters.catalogue) query.set("catalogue", "1");
  if (filters.q) query.set("q", filters.q);
  if (filters.page && filters.page > 1) query.set("page", String(filters.page));
  if (filters.pageSize) query.set("pageSize", String(filters.pageSize));
  const suffix = query.toString();
  return get<OffersPage>(`/v1/public/offers${suffix ? `?${suffix}` : ""}`, signal);
}

export type BasketSeller = { market_id: string; market_label: string; group: Group; unit: string; low: number; high: number; mid: number; observed_on: string };

export type BasketProduct = { id: string; label: string; category: string; sellers: BasketSeller[] };

export const fetchBasket = (ids: string[]): Promise<BasketProduct[]> => (ids.length ? get<BasketProduct[]>(`/v1/public/basket?products=${encodeURIComponent(ids.join(","))}`) : Promise.resolve([]));

export type SearchResult = { id: string; label: string; category: string; sellers: number; aliases: string[]; varieties: Array<{ id: string; qualifier: string }> };

export const fetchSearch = (query: string, signal?: AbortSignal): Promise<SearchResult[]> => fetch(`/v1/public/search?q=${encodeURIComponent(query)}`, signal ? { signal } : {}).then(async (response) => ((await response.json()) as Envelope<SearchResult[]>).payload ?? []);

export type FeedbackKind = "feedback" | "bug";

export async function postFeedback(input: { kind: FeedbackKind; message: string; email?: string | undefined; page: string; website?: string | undefined }): Promise<void> {
  const response = await fetch("/v1/public/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
  if (!response.ok || !body || body.success === false) throw new Error(body?.message ?? `Could not send (${response.status})`);
}

export type DishNames = { en: string; si: string | null; si_latn: string | null; ta: string | null; ta_latn: string | null };

export type Dish = {
  id: string;
  names: DishNames;
  category: string;
  roles: string[];
  meal_slots: string[];
  region: string;
  popularity: 1 | 2 | 3;
  prep_minutes: number;
  cook_minutes: number;
  difficulty: "easy" | "moderate" | "involved";
  diet: string[];
  protein_source: string[];
  spice: "none" | "mild" | "medium" | "hot";
  key_ingredients: string[];
  other_ingredients: string[];
  summary: string;
  occasions: string[];
  variants: string[];
  pairs_with: string[];
  coverage: { priced: number; total: number } | null;
};

export type IngredientPrice = { product_id: string; label: string; sellers: number; cheapest: number; unit: string };

export type DishDetail = Dish & { ingredients: Array<{ product_id: string; label: string | null; price: IngredientPrice | null }>; pairs: Array<{ id: string; label: string }> };

export type Recommendation = { dish: Dish; matched: string[]; missing: string[]; coverage: number; usage: number; score: number };

export type Recommendations = { recommendations: Recommendation[]; labels: Record<string, string>; prices: Record<string, IngredientPrice> };

export const fetchRecommendations = (ids: string[], limit = 12): Promise<Recommendations> =>
  ids.length ? get<Recommendations>(`/v1/public/recipes/recommend?products=${encodeURIComponent(ids.join(","))}&limit=${limit}`) : Promise.resolve({ recommendations: [], labels: {}, prices: {} });

export type Lang = "en" | "si" | "ta";
export type Localized = { en: string; si: string | null; ta: string | null };
export type Nutrition = { kcal: number; protein_g: number; fat_g: number; carb_g: number; fibre_g: number | null; sugar_g: number | null; sodium_mg: number | null };
export type RecipeStep = { text: string; minutes: number | null; /** Ingredient lines the step names, as indices into the recipe's ingredients. */ uses: number[] };
export type IngredientCostLine = { ref: string; label: string; quantity: number; unit: string; amount: number; price_unit: "kg" | "l" | "piece" | "bunch"; unit_price: number; cost: number; seller: string; observed_on: string; stale: boolean };
export type RecipeIngredientView = {
  ref: string | null;
  label: Localized;
  quantity: number;
  base_quantity: number;
  unit: "g" | "ml" | "piece";
  household: string | null;
  preparation: Localized | null;
  optional: boolean;
  scaling: "linear" | "sublinear" | "fixed";
  part: string;
  names: { en: string; si: string | null; si_latn: string | null; ta: string | null; ta_latn: string | null } | null;
  priced: boolean;
  nutrition_known: boolean;
  cost: IngredientCostLine | null;
  purchase: { quantity: number; unit: "kg" | "l" | "piece" } | null;
};
export type RecipeCost = { total: number; per_serving: number; servings: number; lines: IngredientCostLine[]; unpriced: string[]; estimated: boolean };
export type RecipeNutrition = { per_serving: Nutrition; total: Nutrition; servings: number; coverage: { counted: number; with_nutrition: number; missing: string[] }; edible_g_per_serving: number };
/** The full recipe scaled to a headcount: quantities, method in up to three languages, nutrition and cost per serving. */
export type RecipeView = {
  id: string;
  servings: number;
  base_servings: number;
  serving: { role: string; portion_g: number; description: Localized | null };
  yield_g: number;
  ingredients: RecipeIngredientView[];
  steps: { en: RecipeStep[]; si: RecipeStep[] | null; ta: RecipeStep[] | null };
  times: { prep_minutes: number; cook_minutes: number; passive_minutes: number };
  equipment: string[];
  tips: Localized | null;
  health_note: Localized | null;
  tags: string[];
  nutrition: RecipeNutrition;
  cost: RecipeCost | null;
  review: { en: boolean; si: boolean; ta: boolean };
  review_needed: string[];
  languages: Lang[];
};

/** A dish's page: the catalogue entry, its full recipe when it has one, and what signed-in readers made of it. */
export type RecipeDetail = DishDetail & { recipe: RecipeView | null; /** Thumbs from signed-in readers; the site shows `score`, never the dislikes. */ reactions: RecipeScore };

export const fetchRecipe = (id: string, servings?: number | undefined): Promise<RecipeDetail> =>
  get<RecipeDetail>(`/v1/public/recipes/${encodeURIComponent(id)}${servings ? `?servings=${servings}` : ""}`);

/** The route answers at most this many dishes at once. */
export const scoresLimit = 100;

/** The public score (likes less dislikes, never below zero) of up to a hundred dishes, keyed by id. */
export const fetchScores = (ids: string[], signal?: AbortSignal): Promise<Record<string, number>> =>
  ids.length ? get<Record<string, number>>(`/v1/public/recipes/scores?ids=${encodeURIComponent(ids.slice(0, scoresLimit).join(","))}`, signal) : Promise.resolve({});

export type RecipeMetrics = { kcal: number; protein_g: number; fat_g: number; carb_g: number; fibre_g: number | null; minutes: number; tags: string[]; role: string; portion_g: number; languages: Lang[] };
export type RecipeQueryItem = { dish: Dish; metrics: RecipeMetrics; cost_per_serving: number | null; cost_estimated: boolean | null; /** Likes less dislikes from signed-in readers, never below zero. */ score: number };
export type RecipeQueryList = { items: RecipeQueryItem[]; page: number; pageSize: number; total: number; pages: number };
export type RecipeQueryParams = { q?: string | undefined; category?: string | undefined; tags?: string[] | undefined; diet?: string[] | undefined; max_kcal?: number | undefined; min_protein?: number | undefined; max_minutes?: number | undefined; max_cost?: number | undefined; sort?: string | undefined; page?: number | undefined; cost?: boolean | undefined };

/** Recipes that fit a question: by calories, protein, time, tags, or cost per serving. */
export const fetchRecipeQuery = (params: RecipeQueryParams, signal?: AbortSignal): Promise<RecipeQueryList> => {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.tags?.length) search.set("tags", params.tags.join(","));
  if (params.diet?.length) search.set("diet", params.diet.join(","));
  if (params.max_kcal) search.set("max_kcal", String(params.max_kcal));
  if (params.min_protein) search.set("min_protein", String(params.min_protein));
  if (params.max_minutes) search.set("max_minutes", String(params.max_minutes));
  if (params.max_cost) search.set("max_cost", String(params.max_cost));
  if (params.sort) search.set("sort", params.sort);
  if (params.page) search.set("page", String(params.page));
  if (params.cost) search.set("cost", "1");
  search.set("pageSize", "24");
  return get<RecipeQueryList>(`/v1/public/recipes/query?${search}`, signal);
};

/** One dish drawn for the reader, with why it was chosen in plain words ("vegetarian", "under 30 minutes"). */
export type SurprisePick = { id: string; name: string; reasons: string[] };

/** The route takes at most this many ids to leave out; the site sends the most recent ones. */
export const surpriseExcludeLimit = 50;

/**
 * A random dish with a full recipe, weighted by the signed-in person's food preferences (the
 * session cookie carries them). Signed out, `diet` may narrow the draw. 404 with code NO_MATCH
 * when nothing qualifies.
 */
export const fetchSurprise = ({ exclude, diet }: { exclude: string[]; diet?: string | undefined }, signal?: AbortSignal): Promise<SurprisePick> => {
  const search = new URLSearchParams();
  if (exclude.length) search.set("exclude", exclude.slice(-surpriseExcludeLimit).join(","));
  if (diet) search.set("diet", diet);
  const query = search.toString();
  return get<SurprisePick>(`/v1/public/recipes/surprise${query ? `?${query}` : ""}`, signal);
};

export type MenuInput = { id: string; name: string; occasion: string | null; people: number; items: Array<{ recipe_id: string; servings: number | null }>; created_at: string };
export type MenuLine = { ref: string | null; label: string; unit: "g" | "ml" | "piece"; quantity: number; recipes: string[]; cost: number | null; unit_price: number | null; price_unit: "kg" | "l" | "piece" | "bunch" | null; sellers: string[]; stale: boolean };
export type MenuTotals = {
  people: number;
  items: Array<{ recipe_id: string; servings: number; nutrition: RecipeNutrition; cost: RecipeCost | null }>;
  shopping: MenuLine[];
  per_person: { nutrition: Nutrition; cost: number | null };
  total: { nutrition: Nutrition; cost: number | null; estimated: boolean };
  names: Record<string, DishNames>;
  unknown: string[];
};

/** Totals a menu on the server: every recipe scaled to the headcount, nutrition and cost per person, one shopping list. */
export async function computeMenu(menu: MenuInput): Promise<MenuTotals> {
  let response: Response;
  try {
    response = await fetch("/v1/public/menus/compute", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(menu) });
  } catch {
    throw describeFailure(0, null);
  }
  const body = (await response.json().catch(() => null)) as Envelope<MenuTotals> | null;
  if (!response.ok || !body || body.success === false) throw describeFailure(response.status, body?.message);
  return body.payload;
}

export type DishList = { items: Dish[]; page: number; pageSize: number; total: number; pages: number };

export const fetchRecipes = (params: { q?: string | undefined; category?: string | undefined; meal?: string | undefined; page?: number | undefined; pageSize?: number | undefined }, signal?: AbortSignal): Promise<DishList> => {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.meal) search.set("meal", params.meal);
  if (params.page) search.set("page", String(params.page));
  search.set("pageSize", String(params.pageSize ?? 24));
  return get<DishList>(`/v1/public/recipes?${search}`, signal);
};
