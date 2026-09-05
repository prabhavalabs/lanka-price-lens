import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import type { SourceManifest } from "@lanka-pricelens/shared";

import { groupOf, type ExplorerComparison, type ExplorerGroup } from "./explorer.ts";

/**
 * The public read model: what a household sees without signing in. Everything here comes
 * from sources whose rights allow publication (`canPublishSource`), carries the observation
 * date it was seen on, and names the publisher whose attribution must accompany it.
 */

export type PublicSource = {
  id: string;
  name: string;
  publisher: string;
  attribution: string | null;
  landing_url: string;
  cadence: string;
  /** What the source's prices are: open-market wholesale, open-market retail, or supermarket shelf prices. */
  kind: ExplorerGroup | "official";
};

export type PublicGroupPrice = {
  group: ExplorerGroup;
  unit: string;
  sellers: number;
  low: number;
  high: number;
  mid: number;
  observed_on: string;
  /** Change of the sellers' average over the last 30 days, as a percentage, when the history allows it. */
  change_30d_pct: number | null;
};

export type PublicProductCard = {
  id: string;
  label: string;
  label_si: string | null;
  label_ta: string | null;
  category: string;
  comparison: ExplorerComparison;
  prices: PublicGroupPrice[];
};

export type PublicOverview = {
  generated_at: string;
  /** The newest observation day across the published sources. */
  as_of: string | null;
  sources: PublicSource[];
  products: PublicProductCard[];
};

type OverviewRow = {
  id: string;
  label: string;
  label_si: string | null;
  label_ta: string | null;
  category: string;
  comparison: ExplorerComparison;
  groups: Array<{ price_type: string; unit: string; sellers: number; low: string; high: string; mid: string; observed_on: string }>;
};

type ChangeRow = { product_id: string; price_type: string; unit: string; recent: string | null; previous: string | null };

export function publicSources(manifests: SourceManifest[]): PublicSource[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    publisher: manifest.owner,
    attribution: manifest.attribution_text,
    landing_url: manifest.landing_url,
    cadence: manifest.expected_cadence,
    kind: manifest.adapter ? "supermarket" : "official",
  }));
}

/** Every active product with a published price: one card, one price line per seller group (open market, supermarkets, wholesale). */
export async function publicOverview(client: WarehouseClient, sources: SourceManifest[], today = new Date()): Promise<PublicOverview> {
  const sourceIds = sources.map((source) => source.id);
  const rows = sourceIds.length
    ? await client.query<OverviewRow>(
        `WITH latest AS (
           SELECT item.product_id, latest.market_id, latest.price_type, latest.normalized_unit AS unit, latest.observed_on,
                  latest.low_minor, latest.high_minor, latest.mid_minor
           FROM latest_item_price latest
           JOIN item ON item.id = latest.item_id AND item.status = 'active'
           WHERE latest.source_id = ANY($1::text[])
         ), grouped AS (
           SELECT product_id, price_type, unit, COUNT(DISTINCT market_id)::INTEGER AS sellers,
                  MIN(low_minor) AS low, MAX(high_minor) AS high, ROUND(AVG(mid_minor))::BIGINT AS mid, MAX(observed_on)::TEXT AS observed_on
           FROM latest GROUP BY product_id, price_type, unit
         )
         SELECT product.id, product.label_en AS label, product.label_si, product.label_ta, product.category, product.comparison,
                json_agg(json_build_object('price_type', grouped.price_type, 'unit', grouped.unit, 'sellers', grouped.sellers,
                                           'low', grouped.low::TEXT, 'high', grouped.high::TEXT, 'mid', grouped.mid::TEXT, 'observed_on', grouped.observed_on)
                         ORDER BY grouped.price_type, grouped.sellers DESC) AS groups
         FROM product JOIN grouped ON grouped.product_id = product.id
         WHERE product.status = 'active'
         GROUP BY product.id, product.label_en, product.label_si, product.label_ta, product.category, product.comparison
         ORDER BY product.category, product.label_en`,
        [sourceIds],
      )
    : [];
  const day = today.toISOString().slice(0, 10);
  const changes = sourceIds.length
    ? await client.query<ChangeRow>(
        `SELECT item.product_id, daily.price_type, daily.normalized_unit AS unit,
                ROUND(AVG(daily.mid_minor) FILTER (WHERE daily.observed_on > $2::date - 7))::TEXT AS recent,
                ROUND(AVG(daily.mid_minor) FILTER (WHERE daily.observed_on BETWEEN $2::date - 37 AND $2::date - 30))::TEXT AS previous
         FROM daily_item_price daily
         JOIN item ON item.id = daily.item_id AND item.status = 'active'
         WHERE daily.source_id = ANY($1::text[]) AND daily.observed_on >= $2::date - 37
         GROUP BY item.product_id, daily.price_type, daily.normalized_unit`,
        [sourceIds, day],
      )
    : [];
  const changeOf = new Map<string, number | null>();
  for (const row of changes) {
    const recent = row.recent === null ? null : Number(row.recent);
    const previous = row.previous === null ? null : Number(row.previous);
    changeOf.set(`${row.product_id}|${groupOf(row.price_type)}|${row.unit}`, recent !== null && previous ? Math.round(((recent - previous) / previous) * 1000) / 10 : null);
  }
  let asOf: string | null = null;
  const products: PublicProductCard[] = rows.map((row) => {
    // One line per seller group in the unit most sellers use; a seller priced in another unit is not averaged in.
    const perGroup = new Map<ExplorerGroup, PublicGroupPrice>();
    for (const entry of row.groups) {
      const group = groupOf(entry.price_type);
      const current = perGroup.get(group);
      if (current && current.sellers >= entry.sellers) continue;
      perGroup.set(group, {
        group,
        unit: entry.unit,
        sellers: entry.sellers,
        low: Number(entry.low) / 100,
        high: Number(entry.high) / 100,
        mid: Number(entry.mid) / 100,
        observed_on: entry.observed_on,
        change_30d_pct: changeOf.get(`${row.id}|${group}|${entry.unit}`) ?? null,
      });
      if (!asOf || entry.observed_on > asOf) asOf = entry.observed_on;
    }
    const prices = [...perGroup.values()].sort((left, right) => groupRank[left.group] - groupRank[right.group]);
    return { id: row.id, label: row.label, label_si: row.label_si, label_ta: row.label_ta, category: row.category, comparison: row.comparison, prices };
  });
  return { generated_at: new Date().toISOString(), as_of: asOf, sources: publicSources(sources), products };
}

const groupRank: Record<ExplorerGroup, number> = { retail_market: 0, supermarket: 1, wholesale: 2 };

export type BasketSeller = { market_id: string; market_label: string; group: ExplorerGroup; unit: string; low: number; high: number; mid: number; observed_on: string };

export type BasketProduct = { id: string; label: string; category: string; sellers: BasketSeller[] };

/**
 * The latest price of each requested product at every seller, so a shopper's list can be totalled
 * per store. Varieties pool as on the product page (the product's default view), and only published
 * sources count.
 */
export async function publicBasket(client: WarehouseClient, sources: SourceManifest[], productIds: string[]): Promise<BasketProduct[]> {
  const ids = [...new Set(productIds.filter((id) => /^[a-z0-9_]+$/u.test(id)))].slice(0, 60);
  const sourceIds = sources.map((source) => source.id);
  if (!ids.length || !sourceIds.length) return [];
  const rows = await client.query<{ id: string; label: string; category: string; market_id: string; market_label: string; price_type: string; unit: string; observed_on: string; low: string; high: string; mid: string }>(
    `SELECT product.id, product.label_en AS label, product.category, latest.market_id, market.label_en AS market_label, latest.price_type,
            latest.normalized_unit AS unit, MAX(latest.observed_on)::TEXT AS observed_on,
            MIN(latest.low_minor)::TEXT AS low, MAX(latest.high_minor)::TEXT AS high, ROUND(AVG(latest.mid_minor))::TEXT AS mid
     FROM latest_item_price latest
     JOIN item ON item.id = latest.item_id AND item.status = 'active'
     JOIN product ON product.id = item.product_id AND product.status = 'active'
     JOIN market ON market.id = latest.market_id
     WHERE product.id = ANY($1::text[]) AND latest.source_id = ANY($2::text[])
       -- A by-variety product is priced on its base variety, as the product page opens.
       AND (product.comparison = 'pooled' OR item.variety IS NULL OR NOT EXISTS (SELECT 1 FROM item base WHERE base.product_id = product.id AND base.variety IS NULL AND base.status = 'active'))
     GROUP BY product.id, product.label_en, product.category, latest.market_id, market.label_en, latest.price_type, latest.normalized_unit
     ORDER BY product.label_en, latest.price_type, market.label_en`,
    [ids, sourceIds],
  );
  const products = new Map<string, BasketProduct>();
  for (const row of rows) {
    const product = products.get(row.id) ?? { id: row.id, label: row.label, category: row.category, sellers: [] };
    product.sellers.push({ market_id: row.market_id, market_label: row.market_label, group: groupOf(row.price_type), unit: row.unit, low: Number(row.low) / 100, high: Number(row.high) / 100, mid: Number(row.mid) / 100, observed_on: row.observed_on });
    products.set(row.id, product);
  }
  return ids.map((id) => products.get(id)).filter((product): product is BasketProduct => Boolean(product));
}
