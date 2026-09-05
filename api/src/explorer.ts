import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";

import type { PriceRange, RangeRequest } from "./insights.ts";

/**
 * Price explorer: product search and a per-product view of the latest price in
 * every market plus trends over a window. A product is what a consumer names
 * ("potato"); its items are the varieties the sources tell apart (imported, local,
 * Nuwara Eliya, or the unlabelled potato a supermarket sells). The view pools the
 * selected varieties per seller so a shop's shelf price sits beside the market
 * price of the same food. Reads the PostgreSQL warehouse only.
 */

export type ExplorerGroup = "wholesale" | "retail_market" | "supermarket";
export type ExplorerComparison = "pooled" | "by_variety";

export type ExplorerVariety = {
  id: string;
  /** Full item label, "Potato (Imported)". */
  label: string;
  /** What sets the variety apart ("Imported", "Nuwara Eliya", "Whole"), or "Unspecified" when the source states nothing. */
  qualifier: string;
  sellers: number;
  /** The variety a by-variety product opens on. */
  base: boolean;
};

export type ExplorerProduct = {
  id: string;
  label: string;
  category: string;
  comparison: ExplorerComparison;
  varieties: ExplorerVariety[];
  sellers: number;
  last_day: string | null;
  aliases: string[];
};

export type ExplorerLatest = {
  market_id: string;
  market_label: string;
  market_type: string;
  group: ExplorerGroup;
  price_type: string;
  source_id: string;
  observed_on: string;
  unit: string;
  low: number;
  high: number;
  mid: number;
  /** Product labels (brands, packs, varieties) behind the price; one for a bulletin row, several for a store or a pooled view. */
  products: number;
  /** Qualifiers of the varieties this seller reported, for the pooled view. */
  varieties: string[];
  /** Days since the price was observed, as of the request. */
  age_days: number;
  /** Older than the source's cadence allows (a week for a daily source, three weeks for a weekly one): shown, but not a price to shop on. */
  stale: boolean;
};

export type ExplorerPoint = { date: string; mid: number; low: number; high: number };

export type ExplorerSeries = {
  key: string;
  market_id: string;
  market_label: string;
  market_type: string;
  group: ExplorerGroup;
  price_type: string;
  unit: string;
  days: number;
  first: { date: string; mid: number };
  last: { date: string; mid: number };
  change_pct: number | null;
  points: ExplorerPoint[];
};

export type ExplorerSummary = {
  group: ExplorerGroup;
  unit: string | null;
  sellers: number;
  average: number | null;
  lowest: ExplorerLatest | null;
  highest: ExplorerLatest | null;
};

export type ExplorerDetail = {
  product: ExplorerProduct;
  /** Item ids the view pools; the product's default when the caller named none. */
  selected: string[];
  range: PriceRange;
  bounds: { first: string | null; last: string | null };
  latest: ExplorerLatest[];
  summary: ExplorerSummary[];
  /** Supermarket average over wholesale average, as a percentage, when both exist in the same unit. */
  markup_pct: number | null;
  series: ExplorerSeries[];
};

type ItemRow = { id: string; label: string; variety: string | null; origin: string | null; grade: string | null; size: string | null; sellers: number | string };
type ProductRow = { id: string; label: string; category: string; comparison: ExplorerComparison; sellers: number | string; last_day: string | null; items: ItemRow[]; aliases: string[] };

const productSelect = `
  SELECT product.id, product.label_en AS label, product.category, product.comparison,
         (SELECT COUNT(DISTINCT (priced.market_id, priced.price_type)) FROM latest_item_price priced JOIN item owned ON owned.id = priced.item_id
          WHERE owned.product_id = product.id)::INTEGER AS sellers,
         MAX(stats.last_day)::TEXT AS last_day,
         json_agg(json_build_object('id', item.id, 'label', item.label_en, 'variety', item.variety, 'origin', item.origin, 'grade', item.grade, 'size', item.size,
                                    'sellers', COALESCE(stats.markets, 0)) ORDER BY item.id) AS items,
         ARRAY(SELECT alias.label FROM (SELECT DISTINCT alias.label, MIN(CASE WHEN alias.origin = 'bundle' THEN 0 ELSE 1 END) AS rank
                                        FROM item_alias alias JOIN item owner ON owner.id = alias.item_id WHERE owner.product_id = product.id GROUP BY alias.label) alias
               ORDER BY alias.rank, alias.label LIMIT 6) AS aliases
  FROM product
  JOIN item ON item.product_id = product.id AND item.status = 'active'
  LEFT JOIN (SELECT item_id, COUNT(*) AS markets, MAX(observed_on) AS last_day FROM latest_item_price GROUP BY item_id) stats ON stats.item_id = item.id`;
const productGroup = "GROUP BY product.id, product.label_en, product.category, product.comparison";

export async function searchProducts(client: WarehouseClient, query: string, limit = 20): Promise<ExplorerProduct[]> {
  const tokens = query.trim().split(/\s+/u).filter(Boolean).slice(0, 5);
  const params: unknown[] = [];
  const conditions = tokens.map((token) => {
    params.push(`%${escapeLike(token)}%`);
    const index = `$${params.length}`;
    return `(product.label_en ILIKE ${index} OR EXISTS (
      SELECT 1 FROM item candidate WHERE candidate.product_id = product.id AND (candidate.label_en ILIKE ${index}
        OR COALESCE(candidate.variety, '') ILIKE ${index} OR COALESCE(candidate.origin, '') ILIKE ${index}
        OR EXISTS (SELECT 1 FROM item_alias alias WHERE alias.item_id = candidate.id AND alias.label ILIKE ${index}))))`;
  });
  params.push(query.trim().toLowerCase());
  const exact = `$${params.length}`;
  params.push(Math.min(50, Math.max(1, limit)));
  const rows = await client.query<ProductRow>(
    `${productSelect}
     WHERE product.status = 'active'${conditions.length ? ` AND ${conditions.join(" AND ")}` : ""}
     ${productGroup}
     ORDER BY CASE WHEN lower(product.label_en) = ${exact} THEN 0 WHEN lower(product.label_en) LIKE ${exact} || '%' THEN 1 ELSE 2 END, sellers DESC, product.label_en
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(toProduct);
}

export async function productDetail(
  client: WarehouseClient,
  productId: string,
  request: RangeRequest,
  /**
   * Which varieties to pool: item ids, "all", or nothing for the product's default view; `sources` limits the view
   * to those sources (the public site passes the published ones); `cadence` (source id to expected cadence) decides
   * how old a price may be before it counts as stale.
   */
  options: { varieties?: string[] | "all" | undefined; sources?: string[] | undefined; cadence?: Record<string, string> | undefined } = {},
  today = new Date(),
): Promise<ExplorerDetail | null> {
  const sourceFilter = options.sources ? " AND source_id = ANY($2::text[])" : "";
  const sourceParams = options.sources ? [options.sources] : [];
  const [row] = await client.query<ProductRow>(`${productSelect} WHERE product.id = $1 ${productGroup}`, [productId]);
  if (!row) return null;
  const product = toProduct(row);
  const known = new Set(product.varieties.map((variety) => variety.id));
  const requested = options.varieties === "all" ? [...known] : (options.varieties ?? []).filter((id) => known.has(id));
  const selected = requested.length ? requested : defaultSelection(product);
  const qualifierOf = new Map(product.varieties.map((variety) => [variety.id, variety.qualifier]));

  const [bounds] = await client.query<{ first: string | null; last: string | null }>(
    `SELECT MIN(observed_on)::TEXT AS first, MAX(observed_on)::TEXT AS last FROM daily_item_price WHERE item_id = ANY($1::text[])${sourceFilter}`,
    [selected, ...sourceParams],
  );
  const range = resolveRange(request, bounds?.last ?? today.toISOString().slice(0, 10));

  // One row per seller: the selected varieties pooled into that seller's low, high, and average.
  const latestRows = await client.query<{ market_id: string; market_label: string; market_type: string; source_id: string; price_type: string; observed_on: string; unit: string; low_minor: string; high_minor: string; mid_minor: string; observations: string; items: string[] }>(
    `SELECT latest.market_id, market.label_en AS market_label, market.type AS market_type, latest.price_type, latest.normalized_unit AS unit,
            MIN(latest.source_id) AS source_id, MAX(latest.observed_on)::TEXT AS observed_on,
            MIN(latest.low_minor)::TEXT AS low_minor, MAX(latest.high_minor)::TEXT AS high_minor, ROUND(AVG(latest.mid_minor))::TEXT AS mid_minor,
            SUM(latest.observations)::TEXT AS observations, array_agg(DISTINCT latest.item_id) AS items
     FROM latest_item_price latest JOIN market ON market.id = latest.market_id
     WHERE latest.item_id = ANY($1::text[])${sourceFilter.replace("source_id", "latest.source_id")}
     GROUP BY latest.market_id, market.label_en, market.type, latest.price_type, latest.normalized_unit
     ORDER BY latest.price_type, market.type, market.label_en`,
    [selected, ...sourceParams],
  );
  const todayIso = today.toISOString().slice(0, 10);
  const latest: ExplorerLatest[] = latestRows.map((entry) => {
    const age = Math.max(0, daysBetween(entry.observed_on, todayIso));
    return {
      market_id: entry.market_id,
      market_label: entry.market_label,
      market_type: entry.market_type,
      group: groupOf(entry.price_type),
      price_type: entry.price_type,
      source_id: entry.source_id,
      observed_on: entry.observed_on,
      unit: entry.unit,
      low: Number(entry.low_minor) / 100,
      high: Number(entry.high_minor) / 100,
      mid: Number(entry.mid_minor) / 100,
      products: Number(entry.observations),
      varieties: [...new Set(entry.items.map((id) => qualifierOf.get(id) ?? id))].sort(),
      age_days: age,
      stale: age > staleAfterDays(options.cadence?.[entry.source_id]),
    };
  });

  const seriesRows = await client.query<{ market_id: string; market_label: string; market_type: string; price_type: string; unit: string; date: string; low: string; high: string; mid: string }>(
    `SELECT daily.market_id, market.label_en AS market_label, market.type AS market_type, daily.price_type, daily.normalized_unit AS unit,
            daily.observed_on::TEXT AS date, MIN(daily.low_minor)::TEXT AS low, MAX(daily.high_minor)::TEXT AS high, ROUND(AVG(daily.mid_minor))::TEXT AS mid
     FROM daily_item_price daily JOIN market ON market.id = daily.market_id
     WHERE daily.item_id = ANY($1::text[]) AND daily.observed_on BETWEEN $2 AND $3${options.sources ? " AND daily.source_id = ANY($4::text[])" : ""}
     GROUP BY daily.market_id, market.label_en, market.type, daily.price_type, daily.normalized_unit, daily.observed_on
     ORDER BY daily.observed_on`,
    [selected, range.from, range.to, ...sourceParams],
  );
  const bySeries = new Map<string, ExplorerSeries>();
  for (const entry of seriesRows) {
    const key = `${entry.market_id}|${entry.price_type}|${entry.unit}`;
    const point: ExplorerPoint = { date: entry.date, mid: Number(entry.mid) / 100, low: Number(entry.low) / 100, high: Number(entry.high) / 100 };
    const series = bySeries.get(key) ?? {
      key,
      market_id: entry.market_id,
      market_label: entry.market_label,
      market_type: entry.market_type,
      group: groupOf(entry.price_type),
      price_type: entry.price_type,
      unit: entry.unit,
      days: 0,
      first: { date: point.date, mid: point.mid },
      last: { date: point.date, mid: point.mid },
      change_pct: null,
      points: [],
    };
    series.points.push(point);
    series.days += 1;
    series.last = { date: point.date, mid: point.mid };
    bySeries.set(key, series);
  }
  const series = [...bySeries.values()].map((entry) => ({
    ...entry,
    change_pct: entry.days > 1 && entry.first.mid > 0 ? Math.round(((entry.last.mid - entry.first.mid) / entry.first.mid) * 1000) / 10 : null,
  }));
  series.sort((left, right) => groupOrder[left.group] - groupOrder[right.group] || right.days - left.days || left.market_label.localeCompare(right.market_label));

  // A stale price is shown but never the "cheapest": the summary counts fresh sellers only, unless a group has nothing fresh at all.
  const summary = (["wholesale", "retail_market", "supermarket"] as const).map((group) => {
    const rows = latest.filter((entry) => entry.group === group);
    const fresh = rows.filter((entry) => !entry.stale);
    return summarise(group, fresh.length ? fresh : rows);
  });
  const wholesale = summary.find((entry) => entry.group === "wholesale");
  const supermarket = summary.find((entry) => entry.group === "supermarket");
  const markup = wholesale?.average && supermarket?.average && wholesale.unit === supermarket.unit ? Math.round(((supermarket.average - wholesale.average) / wholesale.average) * 1000) / 10 : null;
  return { product, selected, range, bounds: { first: bounds?.first ?? null, last: bounds?.last ?? null }, latest, summary, markup_pct: markup, series };
}

/** Pooled products open on every variety; by-variety products open on the base variety alone. */
export function defaultSelection(product: ExplorerProduct): string[] {
  if (product.comparison === "pooled") return product.varieties.map((variety) => variety.id);
  const base = product.varieties.filter((variety) => variety.base).map((variety) => variety.id);
  return base.length ? base : product.varieties.map((variety) => variety.id);
}

const groupOrder: Record<ExplorerGroup, number> = { wholesale: 0, retail_market: 1, supermarket: 2 };

export function groupOf(priceType: string): ExplorerGroup {
  if (priceType === "wholesale_observed") return "wholesale";
  if (priceType === "retail_online_store") return "supermarket";
  return "retail_market";
}

/** Average across sellers in the group's most common unit; sellers priced in another unit are left out of the average. */
function summarise(group: ExplorerGroup, rows: ExplorerLatest[]): ExplorerSummary {
  if (!rows.length) return { group, unit: null, sellers: 0, average: null, lowest: null, highest: null };
  const unitCounts = new Map<string, number>();
  for (const row of rows) unitCounts.set(row.unit, (unitCounts.get(row.unit) ?? 0) + 1);
  const unit = [...unitCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]![0];
  const comparable = rows.filter((row) => row.unit === unit).sort((left, right) => left.mid - right.mid);
  const average = Math.round((comparable.reduce((sum, row) => sum + row.mid, 0) / comparable.length) * 100) / 100;
  return { group, unit, sellers: rows.length, average, lowest: comparable[0] ?? null, highest: comparable.at(-1) ?? null };
}

function resolveRange(request: RangeRequest, last: string): PriceRange {
  if (request.kind === "custom") return { from: request.from, to: request.to, days: daysBetween(request.from, request.to) + 1, preset: null };
  const to = last;
  const from = new Date(Date.parse(`${to}T00:00:00Z`) - (request.days - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to, days: request.days, preset: request.days };
}

/** How many days a price may be old before it counts as stale: a week for a daily source (weekends, holidays), three weeks for a weekly one. */
export function staleAfterDays(cadence: string | undefined): number {
  return cadence === "weekly" ? 21 : 7;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function toProduct(row: ProductRow): ExplorerProduct {
  const items = (Array.isArray(row.items) ? row.items : []).map((item) => {
    const qualifiers = [item.variety, item.origin, item.grade, item.size].filter((value): value is string => Boolean(value));
    return { id: item.id, label: qualifiers.length ? `${item.label} (${qualifiers.join(", ")})` : item.label, qualifier: qualifiers.join(", ") || "Unspecified", sellers: Number(item.sellers), plain: qualifiers.length === 0 };
  });
  // The base variety: the unqualified item when there is one, else the item named after the product, else the most widely priced.
  const baseId = items.find((item) => item.plain)?.id
    ?? items.find((item) => item.id === row.id.replace(/^product_/u, "item_"))?.id
    ?? [...items].sort((left, right) => right.sellers - left.sellers)[0]?.id;
  const varieties: ExplorerVariety[] = items
    .map(({ plain: _plain, ...item }) => ({ ...item, base: item.id === baseId }))
    .sort((left, right) => Number(right.base) - Number(left.base) || right.sellers - left.sellers || left.qualifier.localeCompare(right.qualifier));
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    comparison: row.comparison === "by_variety" ? "by_variety" : "pooled",
    varieties,
    sellers: Number(row.sellers),
    last_day: row.last_day,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
