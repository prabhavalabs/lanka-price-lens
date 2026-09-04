import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";

import { knowledgeIndexStatus, knowledgeJoins } from "./knowledge-sql.ts";

export type InsightsMonth = { month: string; discovered: number; archived: number; canonicalized: number };
export type InsightsIndexStatus = { status: "indexed" | "indexing" | "failed" | "not_indexed"; count: number };
export type InsightsRunDay = { day: string; succeeded: number; failed: number; running: number };
export type InsightsMarket = { id: string; label: string; observations: number; products: number };
export type InsightsProduct = { id: string; label: string; category: string; observations: number };
export type InsightsVariety = { id: string; product_id: string; label: string; category: string; observations: number; average: number };
export type InsightsSummary = {
  documents: { total: number; by_month: InsightsMonth[]; index_status: InsightsIndexStatus[] };
  observations: {
    total: number;
    products: number;
    markets: number;
    first_observed: string | null;
    last_observed: string | null;
    by_week: Array<{ week: string; count: number }>;
  };
  runs: { by_day: InsightsRunDay[]; succeeded_30d: number; failed_30d: number };
  quality: { complete: number; review_required: number; incomplete: number; not_configured: number; average_score: number | null };
  markets: InsightsMarket[];
  products: InsightsProduct[];
  varieties: InsightsVariety[];
};
export type PricePoint = {
  date: string;
  average: number;
  low: number;
  high: number;
  markets: number;
  /** Seven-trading-day moving average of `average`, once seven points exist. */
  moving_average: number | null;
  /** `average` relative to the first trading week of the window (= 100). */
  index: number | null;
};
export type PriceMarket = { id: string; label: string; average: number; low: number; high: number; observations: number };
export type PriceChange = { horizon_days: number; from_date: string; from_average: number; change: number; change_pct: number } | null;
export type PriceTrend = { direction: "rising" | "falling" | "stable"; slope_per_day: number; change_pct_per_30_days: number; points: number };
export type PriceMonth = { month: string; average: number; low: number; high: number; trading_days: number; change_pct: number | null };
export type PriceRange = { from: string; to: string; days: number; preset: number | null };
export type PriceSeries = {
  product: InsightsProduct;
  /** The variety the series is restricted to, or null when every variety is combined. */
  variety: InsightsVariety | null;
  varieties: InsightsVariety[];
  unit: string | null;
  range: PriceRange;
  points: PricePoint[];
  latest: PricePoint | null;
  previous: PricePoint | null;
  by_market: PriceMarket[];
  changes: { d7: PriceChange; d30: PriceChange; d90: PriceChange; window: PriceChange };
  trend: PriceTrend | null;
  /** Coefficient of variation (%) of the daily average over the last 30 trading days. */
  volatility_pct: number | null;
  window_average: number | null;
  monthly: PriceMonth[];
};
export type BasketPoint = { date: string; index: number; products: number };
export type BasketMover = { item_id: string; product_id: string; label: string; category: string; change_pct: number; from_average: number; to_average: number; days: number };
export type BasketIndex = {
  range: PriceRange;
  base_from: string | null;
  base_to: string | null;
  points: BasketPoint[];
  latest: BasketPoint | null;
  change_pct_7d: number | null;
  change_pct_30d: number | null;
  change_pct_window: number | null;
  products_included: number;
  risers: BasketMover[];
  fallers: BasketMover[];
};
export type RangeRequest = { kind: "preset"; days: number } | { kind: "custom"; from: string; to: string };

export const priceSeriesRanges = [30, 90, 180, 365] as const;
export const maximumCustomRangeDays = 730;
const indexStatuses = ["indexed", "indexing", "failed", "not_indexed"] as const;
const activeObservations = "price_observation observation JOIN item ON item.id = observation.item_id";
const midPriceMinor = "(observation.normalized_min_value_minor + observation.normalized_max_value_minor) / 2.0";
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/u;

export function parseRangeRequest(query: { days?: string | undefined; from?: string | undefined; to?: string | undefined }): RangeRequest | { error: string } {
  if (query.from !== undefined || query.to !== undefined) {
    const from = query.from?.trim() ?? "";
    const to = query.to?.trim() ?? "";
    if (!validIsoDate(from) || !validIsoDate(to)) return { error: "from and to must both be valid YYYY-MM-DD dates" };
    if (from > to) return { error: "from must not be later than to" };
    if (daysBetween(from, to) + 1 > maximumCustomRangeDays) return { error: `Custom ranges are limited to ${maximumCustomRangeDays} days` };
    return { kind: "custom", from, to };
  }
  const days = query.days === undefined ? 90 : Number(query.days);
  if (!priceSeriesRanges.some((range) => range === days)) return { error: `days must be one of ${priceSeriesRanges.join(", ")}` };
  return { kind: "preset", days };
}

function resolveRange(request: RangeRequest, last: string): PriceRange {
  if (request.kind === "custom") return { from: request.from, to: request.to, days: daysBetween(request.from, request.to) + 1, preset: null };
  return { from: shiftDate(last, 1 - request.days), to: last, days: request.days, preset: request.days };
}

export function insightsSummary(database: OperationalDatabase, now = new Date()): InsightsSummary {
  const documentTotal = (database.prepare("SELECT COUNT(*) AS total FROM source_publication").get() as { total: number }).total;
  const byMonth = (database
    .prepare(
      `SELECT substr(published_at, 1, 7) AS month,
       SUM(CASE WHEN status = 'discovered' THEN 1 ELSE 0 END) AS discovered,
       SUM(CASE WHEN status = 'canonicalized' THEN 1 ELSE 0 END) AS canonicalized,
       SUM(CASE WHEN status NOT IN ('discovered', 'canonicalized') THEN 1 ELSE 0 END) AS archived
       FROM source_publication WHERE published_at IS NOT NULL
       GROUP BY month ORDER BY month DESC LIMIT 12`,
    )
    .all() as InsightsMonth[]).reverse();
  const indexCounts = new Map(
    (database
      .prepare(`SELECT ${knowledgeIndexStatus} AS status, COUNT(*) AS count FROM source_publication publication ${knowledgeJoins} GROUP BY 1`)
      .all() as InsightsIndexStatus[]).map((row) => [row.status, row.count]),
  );
  const observationTotals = database
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT item.product_id) AS products, COUNT(DISTINCT observation.market_id) AS markets,
       MIN(observation.observed_from) AS first_observed, MAX(observation.observed_from) AS last_observed
       FROM ${activeObservations} WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed'`,
    )
    .get() as { total: number; products: number; markets: number; first_observed: string | null; last_observed: string | null };
  const byWeek = (database
    .prepare(
      `SELECT date(observed_from, 'weekday 0', '-6 days') AS week, COUNT(*) AS count
       FROM price_observation WHERE status = 'active' AND price_type = 'wholesale_observed' GROUP BY week ORDER BY week DESC LIMIT 26`,
    )
    .all() as Array<{ week: string; count: number }>).reverse();
  const windowStart = isoDate(addDays(now, -29));
  const runRows = database
    .prepare(
      `SELECT substr(started_at, 1, 10) AS day,
       SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
       FROM ingest_run WHERE started_at >= ? GROUP BY day`,
    )
    .all(windowStart) as InsightsRunDay[];
  const runsByDay = new Map(runRows.map((row) => [row.day, row]));
  const byDay = Array.from({ length: 30 }, (_, index) => {
    const day = isoDate(addDays(now, index - 29));
    return runsByDay.get(day) ?? { day, succeeded: 0, failed: 0, running: 0 };
  });
  const qualityRows = database
    .prepare("SELECT status, COUNT(*) AS count, AVG(score) AS average FROM artifact_quality_assessment GROUP BY status")
    .all() as Array<{ status: string; count: number; average: number }>;
  const qualityCount = (status: string) => qualityRows.find((row) => row.status === status)?.count ?? 0;
  const assessed = qualityRows.reduce((sum, row) => sum + row.count, 0);
  const averageScore = assessed ? qualityRows.reduce((sum, row) => sum + row.average * row.count, 0) / assessed : null;
  const markets = database
    .prepare(
      `SELECT market.id, market.label_en AS label, COUNT(observation.id) AS observations, COUNT(DISTINCT item.product_id) AS products
       FROM market LEFT JOIN price_observation observation ON observation.market_id = market.id AND observation.status = 'active' AND observation.price_type = 'wholesale_observed'
       LEFT JOIN item ON item.id = observation.item_id
       WHERE market.status = 'active' GROUP BY market.id ORDER BY observations DESC, label`,
    )
    .all() as InsightsMarket[];

  return {
    documents: {
      total: documentTotal,
      by_month: byMonth,
      index_status: indexStatuses.map((status) => ({ status, count: indexCounts.get(status) ?? 0 })),
    },
    observations: { ...observationTotals, by_week: byWeek },
    runs: {
      by_day: byDay,
      succeeded_30d: byDay.reduce((sum, row) => sum + row.succeeded, 0),
      failed_30d: byDay.reduce((sum, row) => sum + row.failed, 0),
    },
    quality: {
      complete: qualityCount("complete"),
      review_required: qualityCount("review_required"),
      incomplete: qualityCount("incomplete"),
      not_configured: qualityCount("not_configured"),
      average_score: averageScore === null ? null : round(averageScore, 3),
    },
    markets,
    products: canonicalProducts(database),
    varieties: canonicalVarieties(database),
  };
}

export function canonicalProducts(database: OperationalDatabase): InsightsProduct[] {
  return database
    .prepare(
      `SELECT product.id, product.canonical_label_en AS label, product.category, COUNT(observation.id) AS observations
       FROM product LEFT JOIN item ON item.product_id = product.id
       LEFT JOIN price_observation observation ON observation.item_id = item.id AND observation.status = 'active' AND observation.price_type = 'wholesale_observed'
       WHERE product.status = 'active' GROUP BY product.id HAVING observations > 0
       ORDER BY observations DESC, label`,
    )
    .all() as InsightsProduct[];
}

export function canonicalVarieties(database: OperationalDatabase, productId?: string): InsightsVariety[] {
  return database
    .prepare(
      `SELECT item.id, item.product_id, item.canonical_label_en AS label, product.category,
       COUNT(observation.id) AS observations, COALESCE(AVG(${midPriceMinor}) / 100.0, 0) AS average
       FROM item JOIN product ON product.id = item.product_id
       LEFT JOIN price_observation observation ON observation.item_id = item.id AND observation.status = 'active' AND observation.price_type = 'wholesale_observed'
       WHERE item.status = 'active' AND product.status = 'active'${productId ? " AND item.product_id = ?" : ""}
       GROUP BY item.id HAVING observations > 0 ORDER BY observations DESC, label`,
    )
    .all(...(productId ? [productId] : [])) as InsightsVariety[];
}

export function priceSeries(database: OperationalDatabase, productId: string, itemId: string, request: RangeRequest): PriceSeries | null {
  const products = canonicalProducts(database);
  const product = productId ? products.find((candidate) => candidate.id === productId) : products[0];
  if (!product) return null;
  const varieties = canonicalVarieties(database, product.id);
  const variety = itemId ? varieties.find((candidate) => candidate.id === itemId) ?? null : null;
  if (itemId && !variety) return null;
  // Every query below filters either by product (all varieties combined) or by one variety.
  const scope = variety ? "observation.item_id = ?" : "item.product_id = ?";
  const scopeValue = variety ? variety.id : product.id;
  const last = (database
    .prepare(`SELECT MAX(observation.observed_from) AS last FROM ${activeObservations} WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed' AND ${scope}`)
    .get(scopeValue) as { last: string | null }).last;
  const empty = (range: PriceRange): PriceSeries => ({
    product, variety, varieties, unit: null, range, points: [], latest: null, previous: null, by_market: [],
    changes: { d7: null, d30: null, d90: null, window: null }, trend: null, volatility_pct: null, window_average: null, monthly: [],
  });
  if (!last) return empty(resolveRange(request, isoDate(new Date())));
  const range = resolveRange(request, last);
  const unit = (database
    .prepare(
      `SELECT observation.normalized_unit AS unit, COUNT(*) AS count FROM ${activeObservations}
       WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed' AND ${scope} GROUP BY unit ORDER BY count DESC LIMIT 1`,
    )
    .get(scopeValue) as { unit: string } | undefined)?.unit ?? null;
  const rawPoints = database
    .prepare(
      `SELECT observation.observed_from AS date, AVG(${midPriceMinor}) / 100.0 AS average,
       MIN(observation.normalized_min_value_minor) / 100.0 AS low, MAX(observation.normalized_max_value_minor) / 100.0 AS high,
       COUNT(DISTINCT observation.market_id) AS markets
       FROM ${activeObservations}
       WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed' AND ${scope} AND observation.observed_from BETWEEN ? AND ?
       GROUP BY date ORDER BY date`,
    )
    .all(scopeValue, range.from, range.to) as Array<Omit<PricePoint, "moving_average" | "index">>;
  const points = enrichPoints(rawPoints);
  const latest = points.at(-1) ?? null;
  const latestDate = latest?.date ?? last;
  const weekEarlier = shiftDate(latestDate, -7);
  const previous = [...points].reverse().find((point) => point.date <= weekEarlier) ?? null;
  const byMarket = (database
    .prepare(
      `SELECT market.id, market.label_en AS label, AVG(${midPriceMinor}) / 100.0 AS average,
       MIN(observation.normalized_min_value_minor) / 100.0 AS low, MAX(observation.normalized_max_value_minor) / 100.0 AS high,
       COUNT(*) AS observations
       FROM ${activeObservations} JOIN market ON market.id = observation.market_id
       WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed' AND ${scope} AND observation.observed_from > ? AND observation.observed_from <= ?
       GROUP BY market.id ORDER BY average DESC, label`,
    )
    .all(scopeValue, weekEarlier, latestDate) as PriceMarket[]).map((market) => ({
    ...market,
    average: round(market.average, 2),
    low: round(market.low, 2),
    high: round(market.high, 2),
  }));
  const referenceAverage = (date: string) => database
    .prepare(
      `SELECT observation.observed_from AS date, AVG(${midPriceMinor}) / 100.0 AS average FROM ${activeObservations}
       WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed' AND ${scope} AND observation.observed_from <= ?
       GROUP BY observation.observed_from ORDER BY observation.observed_from DESC LIMIT 1`,
    )
    .get(scopeValue, date) as { date: string; average: number } | undefined;
  const change = (horizon: number): PriceChange => {
    if (!latest) return null;
    const reference = referenceAverage(shiftDate(latest.date, -horizon));
    if (!reference || reference.date === latest.date) return null;
    return priceChange(horizon, reference.date, reference.average, latest.average);
  };
  const first = points[0];
  const windowChange: PriceChange = latest && first && first.date !== latest.date
    ? priceChange(daysBetween(first.date, latest.date), first.date, first.average, latest.average)
    : null;
  const recent = points.slice(-30).map((point) => point.average);
  return {
    product,
    variety,
    varieties,
    unit,
    range,
    points,
    latest,
    previous,
    by_market: byMarket,
    changes: { d7: change(7), d30: change(30), d90: change(90), window: windowChange },
    trend: linearTrend(points),
    volatility_pct: recent.length >= 5 ? round(coefficientOfVariation(recent) * 100, 1) : null,
    window_average: points.length ? round(mean(points.map((point) => point.average)), 2) : null,
    monthly: monthlySummary(points),
  };
}

export function basketIndex(database: OperationalDatabase, request: RangeRequest): BasketIndex {
  const varieties = canonicalVarieties(database);
  const last = (database
    .prepare("SELECT MAX(observed_from) AS last FROM price_observation WHERE status = 'active' AND price_type = 'wholesale_observed'")
    .get() as { last: string | null }).last;
  const range = resolveRange(request, last ?? isoDate(new Date()));
  const rows = database
    .prepare(
      `SELECT observation.item_id AS item, observation.observed_from AS date, AVG(${midPriceMinor}) / 100.0 AS average
       FROM price_observation observation
       WHERE observation.status = 'active' AND observation.price_type = 'wholesale_observed' AND observation.observed_from BETWEEN ? AND ?
       GROUP BY item, date ORDER BY item, date`,
    )
    .all(range.from, range.to) as Array<{ item: string; date: string; average: number }>;
  // Each variety is indexed on its own so a variety appearing or disappearing never masquerades as a price move.
  const byVariety = new Map<string, Array<{ date: string; average: number }>>();
  for (const row of rows) byVariety.set(row.item, [...(byVariety.get(row.item) ?? []), { date: row.date, average: row.average }]);
  const labels = new Map(varieties.map((variety) => [variety.id, variety]));
  const tradingDays = new Set(rows.map((row) => row.date)).size;
  const indices = new Map<string, Map<string, number>>();
  const movers: BasketMover[] = [];
  let baseFrom: string | null = null;
  let baseTo: string | null = null;
  for (const [itemId, series] of byVariety) {
    const variety = labels.get(itemId);
    if (!variety || series.length < 5) continue;
    const baseWindow = series.slice(0, 7);
    const base = mean(baseWindow.map((point) => point.average));
    if (!(base > 0)) continue;
    const firstBase = baseWindow[0]!.date;
    const lastBase = baseWindow.at(-1)!.date;
    if (baseFrom === null || firstBase < baseFrom) baseFrom = firstBase;
    if (baseTo === null || lastBase > baseTo) baseTo = lastBase;
    indices.set(itemId, new Map(series.map((point) => [point.date, point.average / base])));
    // Movers need a reasonably continuous series; sparse varieties are indexed but not ranked.
    if (series.length < Math.max(10, tradingDays * 0.4)) continue;
    const tail = series.slice(-3);
    const toAverage = mean(tail.map((point) => point.average));
    movers.push({ item_id: itemId, product_id: variety.product_id, label: variety.label, category: variety.category, change_pct: round((toAverage / base - 1) * 100, 1), from_average: round(base, 2), to_average: round(toAverage, 2), days: series.length });
  }
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  const points: BasketPoint[] = [];
  for (const date of dates) {
    const logs: number[] = [];
    for (const varietyIndex of indices.values()) {
      const value = varietyIndex.get(date);
      if (value !== undefined && value > 0) logs.push(Math.log(value));
    }
    if (logs.length >= Math.min(5, indices.size)) points.push({ date, index: round(Math.exp(mean(logs)) * 100, 2), products: logs.length });
  }
  const latest = points.at(-1) ?? null;
  const referenceBefore = (days: number) => latest ? [...points].reverse().find((point) => point.date <= shiftDate(latest.date, -days)) ?? null : null;
  const reference7 = referenceBefore(7);
  const reference30 = referenceBefore(30);
  movers.sort((left, right) => right.change_pct - left.change_pct);
  return {
    range,
    base_from: baseFrom,
    base_to: baseTo,
    points,
    latest,
    change_pct_7d: latest && reference7 ? round((latest.index / reference7.index - 1) * 100, 1) : null,
    change_pct_30d: latest && reference30 ? round((latest.index / reference30.index - 1) * 100, 1) : null,
    change_pct_window: latest && points[0] ? round((latest.index / points[0]!.index - 1) * 100, 1) : null,
    products_included: indices.size,
    risers: movers.filter((mover) => mover.change_pct > 0).slice(0, 5),
    fallers: movers.filter((mover) => mover.change_pct < 0).reverse().slice(0, 5),
  };
}

export function enrichPoints(points: Array<Omit<PricePoint, "moving_average" | "index">>): PricePoint[] {
  const base = points.length ? mean(points.slice(0, 7).map((point) => point.average)) : 0;
  return points.map((point, position) => {
    const window = points.slice(Math.max(0, position - 6), position + 1);
    return {
      ...point,
      average: round(point.average, 2),
      low: round(point.low, 2),
      high: round(point.high, 2),
      moving_average: window.length === 7 ? round(mean(window.map((candidate) => candidate.average)), 2) : null,
      index: base > 0 ? round((point.average / base) * 100, 1) : null,
    };
  });
}

export function linearTrend(points: Array<{ date: string; average: number }>): PriceTrend | null {
  if (points.length < 5) return null;
  const origin = points[0]!.date;
  const xs = points.map((point) => daysBetween(origin, point.date));
  const ys = points.map((point) => point.average);
  const meanX = mean(xs);
  const meanY = mean(ys);
  const denominator = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  if (denominator === 0 || meanY === 0) return null;
  const slope = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index]! - meanY), 0) / denominator;
  const changePerMonth = (slope * 30) / meanY * 100;
  return {
    direction: changePerMonth > 3 ? "rising" : changePerMonth < -3 ? "falling" : "stable",
    slope_per_day: round(slope, 3),
    change_pct_per_30_days: round(changePerMonth, 1),
    points: points.length,
  };
}

export function monthlySummary(points: PricePoint[]): PriceMonth[] {
  const months = new Map<string, PricePoint[]>();
  for (const point of points) months.set(point.date.slice(0, 7), [...(months.get(point.date.slice(0, 7)) ?? []), point]);
  let previous: number | null = null;
  return [...months.entries()].map(([month, rows]) => {
    const average = mean(rows.map((row) => row.average));
    const summary: PriceMonth = {
      month,
      average: round(average, 2),
      low: round(Math.min(...rows.map((row) => row.low)), 2),
      high: round(Math.max(...rows.map((row) => row.high)), 2),
      trading_days: rows.length,
      change_pct: previous ? round((average / previous - 1) * 100, 1) : null,
    };
    previous = average;
    return summary;
  });
}

function priceChange(horizon: number, fromDate: string, fromAverage: number, toAverage: number): PriceChange {
  return {
    horizon_days: horizon,
    from_date: fromDate,
    from_average: round(fromAverage, 2),
    change: round(toAverage - fromAverage, 2),
    change_pct: fromAverage ? round((toAverage / fromAverage - 1) * 100, 1) : 0,
  };
}

function coefficientOfVariation(values: number[]): number {
  const average = mean(values);
  if (!average) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance) / average;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function validIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && isoDate(parsed) === value;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function shiftDate(date: string, days: number): string {
  return isoDate(addDays(new Date(`${date}T00:00:00Z`), days));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
