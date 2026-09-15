import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import { productIdPattern, watchAlertSchema, watchItemInputSchema, watchLimit, type SourceManifest, type WatchAlert, type WatchEntry, type WatchItem, type WatchPrice } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";

import { envelope, jsonObject, sameOrigin } from "../http.ts";
import { publicBasket } from "../public.ts";
import type { Account, AccountErrorCode } from "./types.ts";

/**
 * The wishlist: products a person stars to keep an eye on (docs/newsletters.md). Each entry is
 * one row per account and product with its own alert rule; the daily price alert mail reads
 * the same rows. Prices beside an entry come from the warehouse at request time, never stored.
 */

export class WatchLimitError extends Error {}

export type WatchStore = {
  /** The account's entries, newest first. */
  list: (accountId: string) => WatchItem[];
  get: (accountId: string, productId: string) => WatchItem | undefined;
  count: (accountId: string) => number;
  /** Adds the product or replaces its alert rule; throws WatchLimitError when the list is full. */
  put: (accountId: string, productId: string, alert: WatchAlert, now: Date) => WatchItem;
  /** False when the product was not on the list. */
  remove: (accountId: string, productId: string) => boolean;
  /** Records what the last alert reported, so the next one waits for a further move. */
  markAlerted: (accountId: string, productId: string, now: Date, priceMinor: number) => void;
  /** Every product anyone watches, for pricing the alert run in one query. */
  productIds: () => string[];
  /** How many products each of the given accounts watches (zero for none), for the admin list. */
  countWatched: (accountIds: string[]) => Map<string, number>;
};

type Row = { account_id: string; product_id: string; alert_json: string; created_at: string; updated_at: string; last_alert_at: string | null; last_alert_minor: number | null };

const columns = "account_id, product_id, alert_json, created_at, updated_at, last_alert_at, last_alert_minor";

function alertOf(json: string): WatchAlert {
  try {
    const parsed = watchAlertSchema.safeParse(JSON.parse(json));
    if (parsed.success) return parsed.data;
  } catch {
    // Fall through: an unreadable rule reads as the default so the entry still shows.
  }
  return watchAlertSchema.parse({});
}

function toItem(row: Row): WatchItem {
  return { product_id: row.product_id, alert: alertOf(row.alert_json), created_at: row.created_at, updated_at: row.updated_at, last_alert_at: row.last_alert_at, last_alert_minor: row.last_alert_minor };
}

export function createWatchStore(database: OperationalDatabase): WatchStore {
  const get = (accountId: string, productId: string): WatchItem | undefined => {
    const row = database.prepare(`SELECT ${columns} FROM account_watch WHERE account_id = ? AND product_id = ?`).get(accountId, productId) as Row | undefined;
    return row ? toItem(row) : undefined;
  };
  const count = (accountId: string): number => (database.prepare("SELECT COUNT(*) AS count FROM account_watch WHERE account_id = ?").get(accountId) as { count: number }).count;
  return {
    list: (accountId) => (database.prepare(`SELECT ${columns} FROM account_watch WHERE account_id = ? ORDER BY created_at DESC, product_id`).all(accountId) as Row[]).map(toItem),
    get,
    count,
    put: (accountId, productId, alert, now) => {
      const stamp = now.toISOString();
      const existing = get(accountId, productId);
      if (existing) {
        database.prepare("UPDATE account_watch SET alert_json = ?, updated_at = ? WHERE account_id = ? AND product_id = ?").run(JSON.stringify(alert), stamp, accountId, productId);
      } else {
        if (count(accountId) >= watchLimit) throw new WatchLimitError(`A wishlist holds up to ${watchLimit} products`);
        database.prepare("INSERT INTO account_watch (account_id, product_id, alert_json, created_at, updated_at, last_alert_at, last_alert_minor) VALUES (?, ?, ?, ?, ?, NULL, NULL)").run(accountId, productId, JSON.stringify(alert), stamp, stamp);
      }
      return get(accountId, productId)!;
    },
    remove: (accountId, productId) => database.prepare("DELETE FROM account_watch WHERE account_id = ? AND product_id = ?").run(accountId, productId).changes > 0,
    markAlerted: (accountId, productId, now, priceMinor) => {
      database.prepare("UPDATE account_watch SET last_alert_at = ?, last_alert_minor = ? WHERE account_id = ? AND product_id = ?").run(now.toISOString(), Math.round(priceMinor), accountId, productId);
    },
    productIds: () => (database.prepare("SELECT DISTINCT product_id FROM account_watch ORDER BY product_id").all() as Array<{ product_id: string }>).map((row) => row.product_id),
    countWatched: (accountIds) => {
      const counts = new Map<string, number>(accountIds.map((id) => [id, 0]));
      if (!accountIds.length) return counts;
      const placeholders = accountIds.map(() => "?").join(", ");
      for (const row of database.prepare(`SELECT account_id, COUNT(*) AS count FROM account_watch WHERE account_id IN (${placeholders}) GROUP BY account_id`).all(...accountIds) as Array<{ account_id: string; count: number }>) counts.set(row.account_id, row.count);
      return counts;
    },
  };
}

/** A wishlist entry's prices with the figures the alert rule compares, in cents. */
export type WatchQuote = WatchPrice & { product_id: string; now_minor: number | null; yesterday_minor: number | null };

const retailTypes = ["retail_observed", "retail_online_store"];

/** The cheapest retail price per product per day over the last ten days, oldest day last. */
async function dailyLows(client: WarehouseClient, sourceIds: string[], productIds: string[]): Promise<Map<string, Array<{ day: string; mid: number }>>> {
  const rows = await client.query<{ product_id: string; day: string; mid: string }>(
    `SELECT item.product_id, daily.observed_on::TEXT AS day, MIN(daily.mid_minor)::TEXT AS mid
     FROM daily_item_price daily
     JOIN item ON item.id = daily.item_id AND item.status = 'active'
     JOIN product ON product.id = item.product_id AND product.status = 'active'
     WHERE item.product_id = ANY($1::text[]) AND daily.source_id = ANY($2::text[]) AND daily.price_type = ANY($3::text[])
       AND daily.observed_on >= CURRENT_DATE - 10
       AND (product.comparison = 'pooled' OR item.variety IS NULL OR NOT EXISTS (SELECT 1 FROM item base WHERE base.product_id = product.id AND base.variety IS NULL AND base.status = 'active'))
     GROUP BY item.product_id, daily.observed_on
     ORDER BY item.product_id, daily.observed_on DESC`,
    [productIds, sourceIds, retailTypes],
  );
  const lows = new Map<string, Array<{ day: string; mid: number }>>();
  for (const row of rows) {
    const series = lows.get(row.product_id) ?? [];
    series.push({ day: row.day, mid: Number(row.mid) });
    lows.set(row.product_id, series);
  }
  return lows;
}

const daysApart = (later: string, earlier: string): number => Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000);

/**
 * Prices for a set of watched products: the cheapest retail seller today (open markets and
 * supermarkets, never wholesale), and the cheapest price the day before for the change and
 * the alert rule. Products the warehouse does not price are left out of the map.
 */
export async function watchPrices(client: WarehouseClient, sources: SourceManifest[], productIds: string[]): Promise<Map<string, WatchQuote>> {
  const ids = [...new Set(productIds.filter((id) => productIdPattern.test(id)))];
  const quotes = new Map<string, WatchQuote>();
  if (!ids.length) return quotes;
  const sourceIds = sources.map((source) => source.id);
  const lows = await dailyLows(client, sourceIds, ids);
  // publicBasket prices at most sixty products per call; the alert run may ask for more.
  for (let start = 0; start < ids.length; start += 60) {
    for (const product of await publicBasket(client, sources, ids.slice(start, start + 60))) {
      const sellers = product.sellers.filter((seller) => seller.group !== "wholesale");
      const cheapest = sellers.reduce<(typeof sellers)[number] | null>((best, seller) => (best === null || seller.mid < best.mid ? seller : best), null);
      const series = lows.get(product.id) ?? [];
      const latest = series[0] ?? null;
      const previous = series[1] && latest && daysApart(latest.day, series[1].day) <= 3 ? series[1] : null;
      const nowMinor = latest ? latest.mid : cheapest ? Math.round(cheapest.mid * 100) : null;
      const yesterdayMinor = previous ? previous.mid : null;
      quotes.set(product.id, {
        product_id: product.id,
        label: product.label,
        category: product.category,
        unit: cheapest?.unit ?? "kg",
        cheapest: cheapest ? { market_id: cheapest.market_id, market_label: cheapest.market_label, group: cheapest.group, price: cheapest.mid, observed_on: cheapest.observed_on } : null,
        yesterday: yesterdayMinor !== null ? yesterdayMinor / 100 : null,
        change_pct: nowMinor !== null && yesterdayMinor ? Math.round(((nowMinor - yesterdayMinor) / yesterdayMinor) * 1000) / 10 : null,
        sellers: sellers.length,
        now_minor: nowMinor,
        yesterday_minor: yesterdayMinor,
      });
    }
  }
  return quotes;
}

export function toWatchPrice(quote: WatchQuote): WatchPrice {
  return { label: quote.label, category: quote.category, unit: quote.unit, cheapest: quote.cheapest, yesterday: quote.yesterday, change_pct: quote.change_pct, sellers: quote.sellers };
}

export type WatchBindings = { Variables: { account: Account; requestId: string } };

export type WatchDeps = {
  store: WatchStore;
  warehouse: () => Promise<WarehouseClient | null>;
  /** The sources whose prices may be shown. */
  published: () => SourceManifest[];
  now?: (() => Date) | undefined;
};

type FailureStatus = 400 | 403 | 404 | 413;

function fail(context: Context<WatchBindings>, status: FailureStatus, message: string, code?: AccountErrorCode | "NOT_FOUND") {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), ...(code ? { code } : {}) }, status);
}

/** Mounted at /v1/account/watchlist behind requireAccount: the list with prices, add or re-rule, change a rule, remove. */
export function watchlistRoutes(deps: WatchDeps): Hono<WatchBindings> {
  const app = new Hono<WatchBindings>();
  const clock = deps.now ?? (() => new Date());

  app.use("*", async (context, next) => {
    if (context.req.method !== "GET" && !sameOrigin(context)) return fail(context, 403, "Cross-origin request rejected");
    return next();
  });

  const productIdOf = (context: Context<WatchBindings>): string | null => {
    const id = (context.req.param("productId") ?? "").slice(0, 80);
    return productIdPattern.test(id) ? id : null;
  };

  app.get("/", async (context) => {
    const items = deps.store.list(context.get("account").id);
    let quotes: Map<string, WatchQuote> | null = null;
    if (items.length) {
      const client = await deps.warehouse();
      if (client) {
        try {
          quotes = await watchPrices(client, deps.published(), items.map((item) => item.product_id));
        } catch (error) {
          console.error(JSON.stringify({ level: "error", message: "Wishlist prices unavailable", detail: error instanceof Error ? error.message : String(error) }));
        }
      }
    }
    const entries: WatchEntry[] = items.map((item) => {
      const quote = quotes?.get(item.product_id);
      return { ...item, price: quote ? toWatchPrice(quote) : null };
    });
    return context.json(envelope(context.get("requestId"), { items: entries, total: entries.length, limit: watchLimit, priced: quotes !== null }));
  });

  app.put("/:productId", async (context) => {
    const productId = productIdOf(context);
    if (!productId) return fail(context, 400, "That is not a product id");
    const body = (await jsonObject(context)) ?? {};
    const parsed = watchItemInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, parsed.error.issues[0]?.message ?? "Invalid alert rule");
    const accountId = context.get("account").id;
    const existing = deps.store.get(accountId, productId);
    const alert = parsed.data.alert ?? existing?.alert ?? watchAlertSchema.parse({});
    try {
      const item = deps.store.put(accountId, productId, alert, clock());
      return context.json(envelope(context.get("requestId"), item, true, existing ? "Alert rule saved" : "Added to your wishlist"), existing ? 200 : 201);
    } catch (error) {
      if (error instanceof WatchLimitError) return fail(context, 413, error.message);
      throw error;
    }
  });

  app.patch("/:productId", async (context) => {
    const productId = productIdOf(context);
    if (!productId) return fail(context, 400, "That is not a product id");
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = watchItemInputSchema.safeParse(body);
    if (!parsed.success || !parsed.data.alert) return fail(context, 400, "Send the alert rule to change");
    const accountId = context.get("account").id;
    if (!deps.store.get(accountId, productId)) return fail(context, 404, "That product is not on your wishlist", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), deps.store.put(accountId, productId, parsed.data.alert, clock()), true, "Alert rule saved"));
  });

  app.delete("/:productId", (context) => {
    const productId = productIdOf(context);
    if (!productId) return fail(context, 400, "That is not a product id");
    if (!deps.store.remove(context.get("account").id, productId)) return fail(context, 404, "That product is not on your wishlist", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), null, true, "Removed from your wishlist"));
  });

  return app;
}
