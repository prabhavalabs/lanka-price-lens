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

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body || body.success === false) throw new Error(body?.message ?? `Request failed (${response.status})`);
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
