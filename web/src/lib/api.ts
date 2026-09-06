/** The public read API, as the site consumes it. Shapes mirror `api/src/public.ts` and `api/src/explorer.ts`. */

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
};

type Envelope<T> = { success: boolean; message: string; payload: T };

/** A failed request, with a message written for the person reading it and whether trying again can help. */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got an answer. */
  readonly status: number;
  readonly retryable: boolean;
  constructor(status: number, message: string, retryable: boolean) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

/** Turns a failed response into what to tell the visitor. The API's own message wins for a plain "not found". */
export function describeFailure(status: number, message: string | null | undefined): ApiError {
  if (status === 0) return new ApiError(0, "Could not reach PriceLens. Check your connection and try again.", true);
  if (status === 404) return new ApiError(404, message ?? "Nothing here.", false);
  if (status === 429) return new ApiError(429, "Too many requests at once. Wait a moment and try again.", true);
  if (status === 502 || status === 503 || status === 504) return new ApiError(status, "PriceLens is restarting or briefly unavailable. It is usually back within a minute.", true);
  if (status >= 500) return new ApiError(status, "Something went wrong on our side. Try again in a moment.", true);
  return new ApiError(status, message ?? `Request failed (${status})`, false);
}

async function get<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: "application/json" } });
  } catch {
    throw describeFailure(0, null);
  }
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body || body.success === false) throw describeFailure(response.status, body?.message);
  return body.payload;
}

export const fetchOverview = (): Promise<Overview> => get<Overview>("/v1/public/overview");

export const fetchProduct = (id: string, days: number): Promise<Detail> => get<Detail>(`/v1/public/products/${encodeURIComponent(id)}?days=${days}`);

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

export const fetchRecipe = (id: string): Promise<DishDetail> => get<DishDetail>(`/v1/public/recipes/${encodeURIComponent(id)}`);

export type DishList = { items: Dish[]; page: number; pageSize: number; total: number; pages: number };

export const fetchRecipes = (params: { q?: string | undefined; category?: string | undefined; meal?: string | undefined; page?: number | undefined }): Promise<DishList> => {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.meal) search.set("meal", params.meal);
  if (params.page) search.set("page", String(params.page));
  search.set("pageSize", "24");
  return get<DishList>(`/v1/public/recipes?${search}`);
};
