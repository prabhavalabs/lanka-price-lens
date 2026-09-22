import { colomboDay } from "../retail/capture.ts";
import type { WarehouseClient } from "../warehouse/client.ts";

/**
 * The deals engine: what fell, what is on offer, and where a product is cheapest across the
 * supermarket online stores, computed from the warehouse's daily series for one Colombo
 * calendar day. Every rule lives in this file (docs/newsletters.md, "Deals engine"), and each
 * one is a small named step so the thresholds can be read off the code.
 *
 * A series is one item at one store in one unit (`daily_item_price` grain without the source,
 * since a store is its own source). Drops and rises are judged per series, because a real
 * price fall happens to one shelf item; the cheapest-store rule and the essentials watch work
 * on the product's pooled price at each store (the average of its items that day, as the
 * explorer shows per seller), because a shopper compares stores at the product level.
 */

export type DealKind = "drop" | "offer" | "cheapest";

export type Deal = {
  product_id: string;
  label: string;
  unit: string;
  market_id: string;
  market: string;
  now_minor: number;
  /** The comparison price and its day: yesterday's price, the fortnight median (dated from the oldest day it covers), or the next cheapest store's price. */
  was_minor: number;
  was_on: string;
  /** Signed, one decimal: -21.3 means down 21.3 %. */
  pct: number;
  kind: DealKind;
  baseline: "yesterday" | "median14" | "other_stores";
  /** The product page on the site. */
  url: string;
};

export type EssentialWatch = {
  product_id: string;
  label: string;
  unit: string;
  cheapest: { market_id: string; market: string; price_minor: number };
  /** The cheapest store today against the cheapest store yesterday; null without a price yesterday. */
  change_pct: number | null;
  /** The cheapest price today against the 14-day median of the cheapest price. */
  trend: "down" | "flat" | "up";
};

/**
 * What a store itself marks down on a catalogue product: its list price beside the price with the
 * offer, both on the product's unit (the warehouse's `store_offer`, from `raw.offer` on the
 * snapshot row). Unlike a drop this needs no history, so an offer that has run for weeks still shows.
 */
export type DeclaredOffer = {
  product_id: string;
  label: string;
  /** The store's own name for the pack on offer. */
  store_label: string;
  unit: string;
  market_id: string;
  market: string;
  now_minor: number;
  was_minor: number;
  /** Signed, one decimal: -20 is 20 % off. */
  pct: number;
  /** "members" when only the store's loyalty members get the price (Keells Nexus). */
  audience: "everyone" | "members";
  offer_label: string | null;
  observed_on: string;
  url: string;
  /** The store's own picture of the pack, as `store_product` filed it: "<source>/ab/<sha>.jpg" under the store-image root, or null when none was taken. */
  image_path: string | null;
};

export type DealsDay = {
  /** YYYY-MM-DD in Asia/Colombo. */
  day: string;
  computed_at: string;
  /** `deals` counts the store's entries in both `deals` and `cheapest`. */
  stores: Array<{ market_id: string; label: string; series: number; deals: number }>;
  /** Drops and offers only (baselines "yesterday" and "median14"), best first, one per product, at most twelve. */
  deals: Deal[];
  /** The cheapest-store picks (kind "cheapest", baseline "other_stores"), largest gap first, one per product, at most eight. */
  cheapest: Deal[];
  /** The largest rises, kind "drop" with a positive pct, at most five. */
  movers_up: Deal[];
  /** The stores' own offers on catalogue products, deepest cut first, one per product, at most twelve. Absent on days saved before the engine read them. */
  store_offers?: DeclaredOffer[];
  /** Which engine wrote the day; see `dealsEngine`. Absent on days saved before the stamp. */
  engine?: number;
  /** Every essential with a price today. */
  essentials: EssentialWatch[];
  stats: { series: number; fresh: number; considered: number };
};

export type DealsOptions = { day?: Date | undefined; essentials: string[] };

/**
 * The engine that writes a day, stamped on it. A saved day is a snapshot the site, the mails, and
 * the post all read back, and nothing recomputes a day once it is saved: a deploy that adds to
 * what the engine puts in a day (a field the card draws from, say) leaves the day already computed
 * that morning short of it, and the feature reads as broken for the rest of the day. Bumped
 * whenever a day gains or changes a field a reader depends on, so a reader that can recompute
 * treats an older day as one it has not got yet.
 */
export const dealsEngine = 1;

/** The thresholds and caps in one place. Percentages are whole numbers; comparisons run on integer minor units, never on rounded percentages. */
export const dealRules = {
  /** The previous observed day must be this close to the latest one for the "yesterday" baseline. */
  yesterdayWithinDays: 3,
  yesterdayDropPct: 10,
  fortnightDays: 14,
  fortnightMinPriorDays: 3,
  fortnightDropPct: 15,
  offerPct: 20,
  cheapestUnderNextPct: 15,
  riserPct: 15,
  maxDeals: 12,
  maxCheapest: 8,
  maxMovers: 5,
  /** A store's own offer is listed from this cut up; smaller ones are shelf noise beside the day's drops. */
  storeOfferPct: 10,
  maxStoreOffers: 12,
  /** An essential's cheapest price counts as moving when it sits this far from its fortnight median. */
  essentialTrendPct: 5,
} as const;

/** One day of one series as the warehouse answers it; numbers arrive as text from PostgreSQL. */
export type DealsRow = {
  product_id: string;
  label: string;
  item_id: string;
  market_id: string;
  market: string;
  unit: string;
  observed_on: string;
  mid_minor: string | number;
};

type Point = { day: string; minor: number };

/** One item at one store in one unit, its daily mid prices oldest first. */
type Series = { product_id: string; label: string; item_id: string; market_id: string; market: string; unit: string; points: Point[] };

/** A past price a series is measured against. */
type Baseline = { baseline: "yesterday" | "median14"; was_minor: number; was_on: string };

/** A product's prices at one store: every item's mid price for each day, pooled on read. */
type StorePrices = { market_id: string; market: string; byDay: Map<string, number[]> };

/** A product in one unit across the stores that sell it in that unit. */
type ProductPrices = { product_id: string; label: string; unit: string; stores: Map<string, StorePrices> };

/** A store's pooled price for a product on its latest day, when that day counts as fresh. */
type StoreOffer = { market_id: string; market: string; day: string; minor: number };

export async function computeDeals(client: WarehouseClient, options: DealsOptions): Promise<DealsDay> {
  const day = colomboDay(options.day ?? new Date());
  const series = groupSeries(await loadWindow(client, day));
  const fresh = series.filter((entry) => isFresh(entry, day));
  const considered = fresh.map((entry) => ({ series: entry, baselines: baselinesOf(entry, day) })).filter((entry) => entry.baselines.length > 0);
  const products = poolByProduct(series);

  // Drops and offers lead the mail; the cheapest-store picks are a list of their own so they never crowd the real falls out.
  const falls = considered.flatMap((entry) => fallsOf(entry.series, entry.baselines));
  const deals = rankDeals(onePerProduct(falls, largerFall), 1).slice(0, dealRules.maxDeals);
  const cheapest = rankDeals(onePerProduct(cheapestStoreDeals(products, day), largerFall), 1).slice(0, dealRules.maxCheapest);

  const rises = considered.flatMap((entry) => risesOf(entry.series, entry.baselines));
  const moversUp = rankDeals(onePerProduct(rises, (candidate, current) => candidate.pct > current.pct), -1).slice(0, dealRules.maxMovers);

  return {
    day,
    computed_at: new Date().toISOString(),
    engine: dealsEngine,
    stores: storeSummary(series, [...deals, ...cheapest]),
    deals,
    cheapest,
    movers_up: moversUp,
    store_offers: rankStoreOffers(await loadStoreOffers(client, day)),
    essentials: essentialsWatch(products, options.essentials, day),
    stats: { series: series.length, fresh: fresh.length, considered: considered.length },
  };
}

/**
 * The day and the fortnight before it for every online-store series, one row per item, store,
 * unit, and day. A by-variety product is read on its base variety alone when it has one, as the
 * product page opens and the basket totals, so a deal names the same thing the site shows.
 */
async function loadWindow(client: WarehouseClient, day: string): Promise<DealsRow[]> {
  return client.query<DealsRow>(
    `SELECT item.product_id, product.label_en AS label, daily.item_id, daily.market_id, market.label_en AS market,
            daily.normalized_unit AS unit, daily.observed_on::TEXT AS observed_on, ROUND(AVG(daily.mid_minor))::TEXT AS mid_minor
     FROM daily_item_price daily
     JOIN item ON item.id = daily.item_id AND item.status = 'active'
     JOIN product ON product.id = item.product_id AND product.status = 'active'
     JOIN market ON market.id = daily.market_id AND market.type = 'online_store'
     WHERE daily.price_type = 'retail_online_store'
       AND daily.observed_on BETWEEN $1::date - ${dealRules.fortnightDays} AND $1::date
       AND (product.comparison = 'pooled' OR item.variety IS NULL OR NOT EXISTS (SELECT 1 FROM item base WHERE base.product_id = product.id AND base.variety IS NULL AND base.status = 'active'))
     GROUP BY item.product_id, product.label_en, daily.item_id, daily.market_id, market.label_en, daily.normalized_unit, daily.observed_on
     ORDER BY item.product_id, daily.market_id, daily.item_id, daily.normalized_unit, daily.observed_on`,
    [day],
  );
}

type StoreOfferRow = { product_id: string; label: string; store_label: string; unit: string; market_id: string; market: string; now_minor: string | number; was_minor: string | number; pct: string | number; audience: string; offer_label: string | null; observed_on: string; image_path: string | null };

/**
 * The stores' own offers on catalogue products for the day and the day before (the freshness
 * every series gets). A warehouse that has not been migrated to carry them yet has none: the
 * offers are an addition to the day and never take it down.
 */
async function loadStoreOffers(client: WarehouseClient, day: string): Promise<StoreOfferRow[]> {
  try {
    return await client.query<StoreOfferRow>(
      `SELECT item.product_id, product.label_en AS label, offer.label AS store_label, offer.normalized_unit AS unit, offer.market_id, market.label_en AS market,
              offer.normalized_offer_minor::TEXT AS now_minor, offer.normalized_list_minor::TEXT AS was_minor, offer.pct::TEXT AS pct,
              offer.audience, offer.offer_label, offer.observed_on::TEXT AS observed_on, offer.image_path
       FROM store_offer offer
       JOIN item ON item.id = offer.item_id AND item.status = 'active'
       JOIN product ON product.id = item.product_id AND product.status = 'active'
       JOIN market ON market.id = offer.market_id AND market.type = 'online_store'
       WHERE offer.observed_on BETWEEN $1::date - 1 AND $1::date AND offer.normalized_offer_minor IS NOT NULL
         -- The same base-variety rule as the price window, so an offer names what the product page shows.
         AND (product.comparison = 'pooled' OR item.variety IS NULL OR NOT EXISTS (SELECT 1 FROM item base WHERE base.product_id = product.id AND base.variety IS NULL AND base.status = 'active'))
       ORDER BY offer.pct, item.product_id, offer.market_id, offer.label`,
      [day],
    );
  } catch (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
}

/** Each store on its own newest day, cuts of ten percent and more, the deepest cut per product, an offer for everyone before a members' one at the same cut. */
function rankStoreOffers(rows: StoreOfferRow[]): DeclaredOffer[] {
  const newest = new Map<string, string>();
  for (const row of rows) if (row.market_id && row.observed_on && row.observed_on > (newest.get(row.market_id) ?? "")) newest.set(row.market_id, row.observed_on);
  const best = new Map<string, DeclaredOffer>();
  for (const row of rows) {
    const now = Number(row.now_minor);
    const was = Number(row.was_minor);
    if (!(now > 0) || !(was > now) || newest.get(row.market_id) !== row.observed_on) continue;
    if (!atMostPercentOf(now, was, 100 - dealRules.storeOfferPct)) continue;
    const offer: DeclaredOffer = {
      product_id: row.product_id, label: row.label, store_label: row.store_label, unit: row.unit, market_id: row.market_id, market: row.market,
      now_minor: now, was_minor: was, pct: -Math.round((1 - now / was) * 1000) / 10, audience: row.audience === "members" ? "members" : "everyone",
      offer_label: row.offer_label ?? null, observed_on: row.observed_on, url: productUrl(row.product_id), image_path: row.image_path ?? null,
    };
    const current = best.get(row.product_id);
    if (!current || offer.pct < current.pct || (offer.pct === current.pct && current.audience === "members" && offer.audience === "everyone")) best.set(row.product_id, offer);
  }
  return [...best.values()].sort((left, right) => left.pct - right.pct || left.label.localeCompare(right.label)).slice(0, dealRules.maxStoreOffers);
}

function groupSeries(rows: DealsRow[]): Series[] {
  const byKey = new Map<string, Series>();
  for (const row of rows) {
    const key = `${row.item_id}|${row.market_id}|${row.unit}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { product_id: row.product_id, label: row.label, item_id: row.item_id, market_id: row.market_id, market: row.market, unit: row.unit, points: [] };
      byKey.set(key, entry);
    }
    entry.points.push({ day: row.observed_on, minor: Number(row.mid_minor) });
  }
  for (const entry of byKey.values()) entry.points.sort((left, right) => left.day.localeCompare(right.day));
  return [...byKey.values()];
}

function latestOf(series: Series): Point {
  const latest = series.points.at(-1);
  if (!latest) throw new Error(`Series ${series.item_id} at ${series.market_id} has no prices`);
  return latest;
}

/** A series counts only when its latest day is the day itself or the day before; stale observations never make a deal. */
function isFresh(series: Series, day: string): boolean {
  const latest = latestOf(series).day;
  return latest === day || latest === shiftDay(day, -1);
}

/**
 * What the latest price can be measured against: the previous observed day when it is within
 * three days, and the median of the prior days in the fortnight when there are at least three.
 */
function baselinesOf(series: Series, day: string): Baseline[] {
  const latest = latestOf(series);
  const windowStart = shiftDay(day, -dealRules.fortnightDays);
  const prior = series.points.filter((point) => point.day < latest.day && point.day >= windowStart);
  const baselines: Baseline[] = [];
  const previous = prior.at(-1);
  if (previous && daysBetween(previous.day, latest.day) <= dealRules.yesterdayWithinDays) {
    baselines.push({ baseline: "yesterday", was_minor: previous.minor, was_on: previous.day });
  }
  const oldest = prior[0];
  if (oldest && prior.length >= dealRules.fortnightMinPriorDays) {
    baselines.push({ baseline: "median14", was_minor: median(prior.map((point) => point.minor)), was_on: oldest.day });
  }
  return baselines;
}

/** Drops: at least 10 % under yesterday or at least 15 % under the fortnight median; both may qualify and the ranking keeps the larger. */
function fallsOf(series: Series, baselines: Baseline[]): Deal[] {
  const now = latestOf(series).minor;
  return baselines
    .filter((baseline) => atMostPercentOf(now, baseline.was_minor, 100 - (baseline.baseline === "yesterday" ? dealRules.yesterdayDropPct : dealRules.fortnightDropPct)))
    .map((baseline) => dealFrom(series, baseline, now));
}

/** Rises of at least 15 % against either baseline, reported as context under `movers_up`. */
function risesOf(series: Series, baselines: Baseline[]): Deal[] {
  const now = latestOf(series).minor;
  return baselines.filter((baseline) => atLeastPercentOf(now, baseline.was_minor, 100 + dealRules.riserPct)).map((baseline) => dealFrom(series, baseline, now));
}

function dealFrom(series: Series, baseline: Baseline, now: number): Deal {
  const pct = percentChange(now, baseline.was_minor);
  return {
    product_id: series.product_id,
    label: series.label,
    unit: series.unit,
    market_id: series.market_id,
    market: series.market,
    now_minor: now,
    was_minor: baseline.was_minor,
    was_on: baseline.was_on,
    pct,
    kind: pct <= -dealRules.offerPct ? "offer" : "drop",
    baseline: baseline.baseline,
    url: productUrl(series.product_id),
  };
}

/** Every item's price per day for each product, unit, and store, so a store's price can be pooled on read. */
function poolByProduct(series: Series[]): ProductPrices[] {
  const products = new Map<string, ProductPrices>();
  for (const entry of series) {
    const key = `${entry.product_id}|${entry.unit}`;
    let product = products.get(key);
    if (!product) {
      product = { product_id: entry.product_id, label: entry.label, unit: entry.unit, stores: new Map() };
      products.set(key, product);
    }
    let store = product.stores.get(entry.market_id);
    if (!store) {
      store = { market_id: entry.market_id, market: entry.market, byDay: new Map() };
      product.stores.set(entry.market_id, store);
    }
    for (const point of entry.points) {
      const prices = store.byDay.get(point.day) ?? [];
      prices.push(point.minor);
      store.byDay.set(point.day, prices);
    }
  }
  return [...products.values()];
}

/** The store's pooled price for the product on a day: the average of its items priced that day. */
function priceOn(store: StorePrices, day: string): number | null {
  const prices = store.byDay.get(day);
  return prices && prices.length ? Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length) : null;
}

/** Each store's price on its latest day, for the stores whose latest day is fresh. */
function freshOffers(product: ProductPrices, day: string): StoreOffer[] {
  const offers: StoreOffer[] = [];
  for (const store of product.stores.values()) {
    const latest = [...store.byDay.keys()].sort().at(-1);
    if (!latest || (latest !== day && latest !== shiftDay(day, -1))) continue;
    const minor = priceOn(store, latest);
    if (minor !== null) offers.push({ market_id: store.market_id, market: store.market, day: latest, minor });
  }
  return offers.sort((left, right) => left.minor - right.minor || left.market_id.localeCompare(right.market_id));
}

/** Cheapest store: among two or more stores selling the product in the same unit, the cheapest is a deal when it is at least 15 % under the next cheapest. */
function cheapestStoreDeals(products: ProductPrices[], day: string): Deal[] {
  const deals: Deal[] = [];
  for (const product of products) {
    const [cheapest, next] = freshOffers(product, day);
    if (!cheapest || !next) continue;
    if (!atMostPercentOf(cheapest.minor, next.minor, 100 - dealRules.cheapestUnderNextPct)) continue;
    deals.push({
      product_id: product.product_id,
      label: product.label,
      unit: product.unit,
      market_id: cheapest.market_id,
      market: cheapest.market,
      now_minor: cheapest.minor,
      was_minor: next.minor,
      was_on: next.day,
      pct: percentChange(cheapest.minor, next.minor),
      kind: "cheapest",
      baseline: "other_stores",
      url: productUrl(product.product_id),
    });
  }
  return deals;
}

const largerFall = (candidate: Deal, current: Deal): boolean => candidate.pct < current.pct;

/** One deal per product: the first candidate wins until a better one appears, so the SQL order settles ties. */
function onePerProduct(deals: Deal[], better: (candidate: Deal, current: Deal) => boolean): Deal[] {
  const best = new Map<string, Deal>();
  for (const deal of deals) {
    const current = best.get(deal.product_id);
    if (!current || better(deal, current)) best.set(deal.product_id, deal);
  }
  return [...best.values()];
}

/** Falls ascending (the largest fall first) or rises descending, then by product id so the order is stable. */
function rankDeals(deals: Deal[], direction: 1 | -1): Deal[] {
  return [...deals].sort((left, right) => direction * (left.pct - right.pct) || left.product_id.localeCompare(right.product_id));
}

/**
 * Essentials: each listed product with a fresh price, in the unit most stores sell it in, with
 * its cheapest store, how that compares with the cheapest store yesterday, and where it sits
 * against the fortnight median of the cheapest price (at least three prior days, else flat).
 */
function essentialsWatch(products: ProductPrices[], essentials: string[], day: string): EssentialWatch[] {
  const watch: EssentialWatch[] = [];
  for (const productId of new Set(essentials)) {
    const chosen = products
      .filter((product) => product.product_id === productId)
      .map((product) => ({ product, offers: freshOffers(product, day) }))
      .filter((entry) => entry.offers.length > 0)
      .sort((left, right) => right.offers.length - left.offers.length || left.product.unit.localeCompare(right.product.unit))[0];
    if (!chosen) continue;
    const [cheapest] = chosen.offers;
    if (!cheapest) continue;
    const referenceDay = chosen.offers.map((offer) => offer.day).sort().at(-1) ?? day;
    const yesterday = cheapestOn(chosen.product, shiftDay(referenceDay, -1));
    watch.push({
      product_id: chosen.product.product_id,
      label: chosen.product.label,
      unit: chosen.product.unit,
      cheapest: { market_id: cheapest.market_id, market: cheapest.market, price_minor: cheapest.minor },
      change_pct: yesterday === null ? null : percentChange(cheapest.minor, yesterday),
      trend: trendOf(cheapest.minor, medianCheapest(chosen.product, shiftDay(day, -dealRules.fortnightDays), shiftDay(referenceDay, -1))),
    });
  }
  return watch;
}

/** The lowest store price for the product on one day, or null when no store priced it. */
function cheapestOn(product: ProductPrices, day: string): number | null {
  let cheapest: number | null = null;
  for (const store of product.stores.values()) {
    const price = priceOn(store, day);
    if (price !== null && (cheapest === null || price < cheapest)) cheapest = price;
  }
  return cheapest;
}

/** The median of the cheapest price over the days between `from` and `to` inclusive, or null with fewer than three priced days. */
function medianCheapest(product: ProductPrices, from: string, to: string): number | null {
  const prices: number[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const price = cheapestOn(product, day);
    if (price !== null) prices.push(price);
  }
  return prices.length >= dealRules.fortnightMinPriorDays ? median(prices) : null;
}

function trendOf(now: number, medianPrice: number | null): EssentialWatch["trend"] {
  if (medianPrice === null) return "flat";
  if (atMostPercentOf(now, medianPrice, 100 - dealRules.essentialTrendPct)) return "down";
  if (atLeastPercentOf(now, medianPrice, 100 + dealRules.essentialTrendPct)) return "up";
  return "flat";
}

/** Every store seen in the window with how many series it has and how many of the day's deals and cheapest-store picks it won, by label. */
function storeSummary(series: Series[], deals: Deal[]): DealsDay["stores"] {
  const stores = new Map<string, DealsDay["stores"][number]>();
  for (const entry of series) {
    const store = stores.get(entry.market_id) ?? { market_id: entry.market_id, label: entry.market, series: 0, deals: 0 };
    store.series += 1;
    stores.set(entry.market_id, store);
  }
  for (const deal of deals) {
    const store = stores.get(deal.market_id);
    if (store) store.deals += 1;
  }
  return [...stores.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function productUrl(productId: string): string {
  return `/p/${productId}`;
}

/** `now` is at most `percent` % of `was`, on integers so 0.9 × 2350 never turns into 2115.0000000000005. */
function atMostPercentOf(now: number, was: number, percent: number): boolean {
  return now * 100 <= was * percent;
}

function atLeastPercentOf(now: number, was: number, percent: number): boolean {
  return now * 100 >= was * percent;
}

/** Signed change from `was` to `now` rounded to one decimal; a change too small to show is 0, never -0. */
export function percentChange(now: number, was: number): number {
  if (was === 0) return 0;
  const pct = Math.round(((now - was) / was) * 1000) / 10;
  return pct === 0 ? 0 : pct;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  const lower = sorted[middle - 1] ?? upper;
  return sorted.length % 2 === 0 ? Math.round((lower + upper) / 2) : upper;
}

/** The calendar day `delta` days from a YYYY-MM-DD day. */
export function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}
