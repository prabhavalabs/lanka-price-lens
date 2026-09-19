import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import type { SourceManifest } from "@lanka-pricelens/shared";

/**
 * Store offers as a household reads them: what each supermarket itself marks down today, in the
 * store's own wording, with the list price beside the offer price and who the offer is for.
 * Each store is read on its own newest day (the stores are captured at different hours), and a
 * store whose newest offers are older than `freshDays` is left out rather than shown stale.
 * Rows whose label maps to a product link to its page; the rest are the store's wider shelves.
 */

export type PublicOffer = {
  id: string;
  market_id: string | null;
  market: string;
  /** The store's own product name. */
  label: string;
  category: string | null;
  /** The pack the prices are for, as the store sells it ("500 g", "1 piece"). */
  pack: string;
  /** What every shopper pays for the pack today, rupees. */
  price: number;
  /** The store's regular price, rupees. */
  list: number;
  /** The price with the offer, rupees; equal to `price` unless the offer is for members only. */
  offer: number;
  /** Signed, one decimal: -20 is 20 % off. */
  pct: number;
  kind: "mrp" | "promo_price" | "discount" | "compare_at";
  audience: "everyone" | "members";
  offer_label: string | null;
  max_quantity: number | null;
  observed_on: string;
  /** The catalogue product the label maps to, with the offer on the product's unit so it compares with other sellers. */
  product: { id: string; label: string; unit: string; list: number; offer: number } | null;
};

export type OfferStore = { market_id: string; market: string; observed_on: string; offers: number };

export type OffersPage = {
  generated_at: string;
  /** The newest day any store's offers were seen on. */
  as_of: string | null;
  stores: OfferStore[];
  total: number;
  page: number;
  page_size: number;
  items: PublicOffer[];
};

export type OfferQuery = {
  market?: string | undefined;
  search?: string | undefined;
  audience?: "everyone" | "members" | undefined;
  /** Only offers on products the catalogue carries. */
  catalogue?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
};

export const offerRules = { freshDays: 3, defaultPageSize: 48, maxPageSize: 200 } as const;

type OfferRow = {
  staging_id: string; market_id: string | null; market: string; label: string; category: string | null; pack_quantity: string; pack_unit: string;
  price_minor: string; list_minor: string; offer_minor: string; pct: string; kind: PublicOffer["kind"]; audience: PublicOffer["audience"];
  offer_label: string | null; max_quantity: number | null; observed_on: string;
  product_id: string | null; product_label: string | null; normalized_unit: string | null; normalized_list_minor: string | null; normalized_offer_minor: string | null;
};

export function parseOfferQuery(query: Record<string, string | undefined>): OfferQuery {
  const audience = query.audience === "everyone" || query.audience === "members" ? query.audience : undefined;
  const page = Number(query.page);
  const pageSize = Number(query.pageSize);
  return {
    market: query.market && /^[a-z0-9_]{1,80}$/u.test(query.market) ? query.market : undefined,
    search: query.q?.trim().slice(0, 80) || undefined,
    audience,
    catalogue: query.catalogue === "1" || query.catalogue === "true" ? true : undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, offerRules.maxPageSize) : offerRules.defaultPageSize,
  };
}

export async function publicOffers(client: WarehouseClient, sources: SourceManifest[], query: OfferQuery = {}, today = new Date()): Promise<OffersPage> {
  const sourceIds = sources.map((source) => source.id);
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? offerRules.defaultPageSize;
  const empty: OffersPage = { generated_at: new Date().toISOString(), as_of: null, stores: [], total: 0, page, page_size: pageSize, items: [] };
  if (!sourceIds.length) return empty;
  const day = today.toISOString().slice(0, 10);
  // Each store on its own newest day, so a store captured later in the morning never hides the others.
  const latest = `SELECT source_id, market_label, MAX(observed_on) AS day FROM store_offer
                  WHERE source_id = ANY($1::text[]) AND observed_on >= $2::date - ${offerRules.freshDays} GROUP BY source_id, market_label`;
  const stores = await client.query<{ market_id: string | null; market: string; observed_on: string; offers: string }>(
    `WITH latest AS (${latest})
     SELECT offer.market_id, COALESCE(market.label_en, offer.market_label) AS market, offer.observed_on::TEXT AS observed_on, COUNT(*)::TEXT AS offers
     FROM store_offer offer JOIN latest ON latest.source_id = offer.source_id AND latest.market_label = offer.market_label AND latest.day = offer.observed_on
     LEFT JOIN market ON market.id = offer.market_id
     GROUP BY offer.market_id, COALESCE(market.label_en, offer.market_label), offer.observed_on ORDER BY market`,
    [sourceIds, day],
  );
  if (!stores.length) return empty;

  const filters: string[] = [];
  const params: unknown[] = [sourceIds, day];
  if (query.market) { params.push(query.market); filters.push(`offer.market_id = $${params.length}`); }
  if (query.audience) { params.push(query.audience); filters.push(`offer.audience = $${params.length}`); }
  if (query.catalogue) filters.push("offer.item_id IS NOT NULL");
  if (query.search) { params.push(`%${query.search.replace(/[\\%_]/gu, (match) => `\\${match}`)}%`); filters.push(`(offer.label ILIKE $${params.length} OR product.label_en ILIKE $${params.length})`); }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const from = `FROM store_offer offer
     JOIN latest ON latest.source_id = offer.source_id AND latest.market_label = offer.market_label AND latest.day = offer.observed_on
     LEFT JOIN market ON market.id = offer.market_id
     LEFT JOIN item ON item.id = offer.item_id AND item.status = 'active'
     LEFT JOIN product ON product.id = item.product_id AND product.status = 'active'`;
  const total = Number((await client.query<{ count: string }>(`WITH latest AS (${latest}) SELECT COUNT(*)::TEXT AS count ${from} ${where}`, params))[0]?.count ?? 0);
  const rows = await client.query<OfferRow>(
    `WITH latest AS (${latest})
     SELECT offer.staging_id, offer.market_id, COALESCE(market.label_en, offer.market_label) AS market, offer.label, offer.category, offer.pack_quantity, offer.pack_unit,
            offer.price_minor::TEXT, offer.list_minor::TEXT, offer.offer_minor::TEXT, offer.pct::TEXT, offer.kind, offer.audience, offer.offer_label, offer.max_quantity,
            offer.observed_on::TEXT AS observed_on, product.id AS product_id, product.label_en AS product_label, offer.normalized_unit,
            offer.normalized_list_minor::TEXT, offer.normalized_offer_minor::TEXT
     ${from} ${where}
     -- The deepest cut first; a catalogue product before a shelf item at the same cut, then by name so pages are stable.
     ORDER BY offer.pct, (product.id IS NULL), offer.label, offer.staging_id
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return {
    generated_at: new Date().toISOString(),
    as_of: stores.reduce<string | null>((newest, store) => (!newest || store.observed_on > newest ? store.observed_on : newest), null),
    stores: stores.filter((store): store is typeof store & { market_id: string } => store.market_id !== null).map((store) => ({ market_id: store.market_id, market: store.market, observed_on: store.observed_on, offers: Number(store.offers) })),
    total,
    page,
    page_size: pageSize,
    items: rows.map(offerOf),
  };
}

/** The offers on one product's items, newest day per store, cheapest offer first: what the product page and the deals engine read. */
export async function productOffers(client: WarehouseClient, sources: SourceManifest[], productIds: string[], today = new Date()): Promise<Map<string, PublicOffer[]>> {
  const sourceIds = sources.map((source) => source.id);
  const ids = [...new Set(productIds)].filter((id) => /^[a-z0-9_]+$/u.test(id));
  const byProduct = new Map<string, PublicOffer[]>();
  if (!sourceIds.length || !ids.length) return byProduct;
  const rows = await client.query<OfferRow>(
    `WITH latest AS (SELECT source_id, market_label, MAX(observed_on) AS day FROM store_offer
                     WHERE source_id = ANY($1::text[]) AND observed_on >= $2::date - ${offerRules.freshDays} GROUP BY source_id, market_label)
     SELECT offer.staging_id, offer.market_id, COALESCE(market.label_en, offer.market_label) AS market, offer.label, offer.category, offer.pack_quantity, offer.pack_unit,
            offer.price_minor::TEXT, offer.list_minor::TEXT, offer.offer_minor::TEXT, offer.pct::TEXT, offer.kind, offer.audience, offer.offer_label, offer.max_quantity,
            offer.observed_on::TEXT AS observed_on, product.id AS product_id, product.label_en AS product_label, offer.normalized_unit,
            offer.normalized_list_minor::TEXT, offer.normalized_offer_minor::TEXT
     FROM store_offer offer
     JOIN latest ON latest.source_id = offer.source_id AND latest.market_label = offer.market_label AND latest.day = offer.observed_on
     LEFT JOIN market ON market.id = offer.market_id
     JOIN item ON item.id = offer.item_id AND item.status = 'active'
     JOIN product ON product.id = item.product_id AND product.status = 'active'
     WHERE product.id = ANY($3::text[])
     ORDER BY product.id, offer.normalized_offer_minor, offer.label`,
    [sourceIds, today.toISOString().slice(0, 10), ids],
  );
  for (const row of rows) {
    if (!row.product_id) continue;
    byProduct.set(row.product_id, [...(byProduct.get(row.product_id) ?? []), offerOf(row)]);
  }
  return byProduct;
}

function offerOf(row: OfferRow): PublicOffer {
  const rupees = (minor: string) => Number(minor) / 100;
  return {
    id: row.staging_id,
    market_id: row.market_id,
    market: row.market,
    label: row.label,
    category: row.category,
    pack: `${row.pack_quantity} ${row.pack_unit}`,
    price: rupees(row.price_minor),
    list: rupees(row.list_minor),
    offer: rupees(row.offer_minor),
    pct: Number(row.pct),
    kind: row.kind,
    audience: row.audience,
    offer_label: row.offer_label,
    max_quantity: row.max_quantity,
    observed_on: row.observed_on,
    product: row.product_id && row.product_label && row.normalized_unit && row.normalized_list_minor && row.normalized_offer_minor
      ? { id: row.product_id, label: row.product_label, unit: row.normalized_unit, list: rupees(row.normalized_list_minor), offer: rupees(row.normalized_offer_minor) }
      : null,
  };
}
