import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";

import type { PriceRange, RangeRequest } from "./insights.ts";

/**
 * Price explorer: item search and a per-item view of the latest price in every
 * market plus trends over a window. Reads the PostgreSQL warehouse only
 * (daily_item_price, latest_item_price, item_alias), never the operational store.
 */

export type ExplorerItem = {
  id: string;
  label: string;
  display: string;
  product_id: string;
  product_label: string;
  category: string;
  variety: string | null;
  origin: string | null;
  grade: string | null;
  markets: number;
  last_day: string | null;
  aliases: string[];
};

export type ExplorerGroup = "wholesale" | "retail_market" | "supermarket";

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
  item: ExplorerItem;
  range: PriceRange;
  bounds: { first: string | null; last: string | null };
  latest: ExplorerLatest[];
  summary: ExplorerSummary[];
  /** Supermarket average over wholesale average, as a percentage, when both exist in the same unit. */
  markup_pct: number | null;
  series: ExplorerSeries[];
};

const itemSelect = `
  SELECT item.id, item.label_en AS label, item.product_id, product.label_en AS product_label, product.category,
         item.variety, item.origin, item.grade,
         COALESCE(stats.markets, 0)::INTEGER AS markets, stats.last_day::TEXT AS last_day,
         ARRAY(SELECT DISTINCT alias.label FROM item_alias alias WHERE alias.item_id = item.id ORDER BY alias.label LIMIT 6) AS aliases
  FROM item
  JOIN product ON product.id = item.product_id
  LEFT JOIN (SELECT item_id, COUNT(*) AS markets, MAX(observed_on) AS last_day FROM latest_item_price GROUP BY item_id) stats ON stats.item_id = item.id`;

type ItemRow = Omit<ExplorerItem, "display" | "markets"> & { markets: number | string };

export async function searchItems(client: WarehouseClient, query: string, limit = 20): Promise<ExplorerItem[]> {
  const tokens = query.trim().split(/\s+/u).filter(Boolean).slice(0, 5);
  const params: unknown[] = [];
  const conditions = tokens.map((token) => {
    params.push(`%${escapeLike(token)}%`);
    const index = `$${params.length}`;
    return `(item.label_en ILIKE ${index} OR product.label_en ILIKE ${index} OR COALESCE(item.variety, '') ILIKE ${index}
      OR COALESCE(item.origin, '') ILIKE ${index} OR EXISTS (SELECT 1 FROM item_alias alias WHERE alias.item_id = item.id AND alias.label ILIKE ${index}))`;
  });
  params.push(query.trim().toLowerCase());
  const exact = `$${params.length}`;
  params.push(Math.min(50, Math.max(1, limit)));
  const rows = await client.query<ItemRow>(
    `${itemSelect}
     WHERE item.status = 'active'${conditions.length ? ` AND ${conditions.join(" AND ")}` : ""}
     ORDER BY CASE WHEN lower(item.label_en) = ${exact} OR lower(product.label_en) = ${exact} THEN 0
                   WHEN lower(item.label_en) LIKE ${exact} || '%' OR lower(product.label_en) LIKE ${exact} || '%' THEN 1 ELSE 2 END,
              COALESCE(stats.markets, 0) DESC, item.label_en, item.id
     LIMIT $${params.length}`,
    params,
  );
  return rows.map(toItem);
}

export async function itemDetail(client: WarehouseClient, itemId: string, request: RangeRequest, today = new Date()): Promise<ExplorerDetail | null> {
  const [row] = await client.query<ItemRow>(`${itemSelect} WHERE item.id = $1`, [itemId]);
  if (!row) return null;
  const item = toItem(row);
  const [bounds] = await client.query<{ first: string | null; last: string | null }>(
    "SELECT MIN(observed_on)::TEXT AS first, MAX(observed_on)::TEXT AS last FROM daily_item_price WHERE item_id = $1",
    [itemId],
  );
  const range = resolveRange(request, bounds?.last ?? today.toISOString().slice(0, 10));
  const latestRows = await client.query<{ market_id: string; market_label: string; market_type: string; source_id: string; price_type: string; observed_on: string; unit: string; low_minor: string; high_minor: string; mid_minor: string }>(
    `SELECT latest.market_id, market.label_en AS market_label, market.type AS market_type, latest.source_id, latest.price_type,
            latest.observed_on::TEXT, latest.normalized_unit AS unit, latest.low_minor::TEXT, latest.high_minor::TEXT, latest.mid_minor::TEXT
     FROM latest_item_price latest JOIN market ON market.id = latest.market_id
     WHERE latest.item_id = $1 ORDER BY latest.price_type, market.type, market.label_en`,
    [itemId],
  );
  const latest: ExplorerLatest[] = latestRows.map((entry) => ({
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
  }));
  const seriesRows = await client.query<{ market_id: string; market_label: string; market_type: string; price_type: string; unit: string; date: string; low: string; high: string; mid: string }>(
    `SELECT daily.market_id, market.label_en AS market_label, market.type AS market_type, daily.price_type, daily.normalized_unit AS unit,
            daily.observed_on::TEXT AS date, MIN(daily.low_minor)::TEXT AS low, MAX(daily.high_minor)::TEXT AS high, ROUND(AVG(daily.mid_minor))::TEXT AS mid
     FROM daily_item_price daily JOIN market ON market.id = daily.market_id
     WHERE daily.item_id = $1 AND daily.observed_on BETWEEN $2 AND $3
     GROUP BY daily.market_id, market.label_en, market.type, daily.price_type, daily.normalized_unit, daily.observed_on
     ORDER BY daily.observed_on`,
    [itemId, range.from, range.to],
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

  const summary = (["wholesale", "retail_market", "supermarket"] as const).map((group) => summarise(group, latest.filter((entry) => entry.group === group)));
  const wholesale = summary.find((entry) => entry.group === "wholesale");
  const supermarket = summary.find((entry) => entry.group === "supermarket");
  const markup = wholesale?.average && supermarket?.average && wholesale.unit === supermarket.unit ? Math.round(((supermarket.average - wholesale.average) / wholesale.average) * 1000) / 10 : null;
  return { item, range, bounds: { first: bounds?.first ?? null, last: bounds?.last ?? null }, latest, summary, markup_pct: markup, series };
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

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function toItem(row: ItemRow): ExplorerItem {
  const qualifiers = [row.variety, row.origin, row.grade].filter((value): value is string => Boolean(value));
  return {
    id: row.id,
    label: row.label,
    display: qualifiers.length ? `${row.label} (${qualifiers.join(", ")})` : row.label,
    product_id: row.product_id,
    product_label: row.product_label,
    category: row.category,
    variety: row.variety,
    origin: row.origin,
    grade: row.grade,
    markets: Number(row.markets),
    last_day: row.last_day,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
