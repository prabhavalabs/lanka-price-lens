import { describeFailure, type Envelope } from "./api.ts";

/**
 * The ingredient registry as the recipe editor searches it: every ingredient a recipe may name,
 * priced products and pantry entries alike, by name in any of the three languages.
 *
 * Route: `GET /v1/public/ingredients?q=<text>&limit=<n>` answering the usual envelope with
 * `{ items: IngredientSummary[] }`, ranked by match; an empty `q` answers the most common ones.
 */
export type IngredientSummary = { id: string; names: { en: string; si: string | null; ta: string | null }; group: string; /** True for products the warehouse prices. */ priced: boolean; /** The unit a recipe usually measures it in, when the registry knows. */ unit_hint?: "g" | "ml" | "piece" | undefined };

export async function fetchIngredients(query: string, signal?: AbortSignal, limit = 20): Promise<IngredientSummary[]> {
  const search = new URLSearchParams({ q: query, limit: String(limit) });
  let response: Response;
  try {
    response = await fetch(`/v1/public/ingredients?${search}`, { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw describeFailure(0, null);
  }
  const body = (await response.json().catch(() => null)) as Envelope<{ items: IngredientSummary[] }> | null;
  if (!response.ok || !body || body.success === false) throw describeFailure(response.status, body?.message);
  return Array.isArray(body.payload?.items) ? body.payload.items : [];
}
