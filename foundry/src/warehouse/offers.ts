import type { OperationalDatabase } from "../db.ts";
import { readStoreLinks } from "../retail/links.ts";
import { readOffer } from "../retail/offer.ts";
import { syncStoreProducts } from "../retail/store-products.ts";
import { valuesPlaceholders, type WarehouseClient } from "./client.ts";

/**
 * Store offers in the warehouse: every row of a retail snapshot that carries the store's own
 * offer (`raw.offer`, see retail/offer.ts), whether or not the label maps to a canonical item.
 * A mapped row also carries its item and the offer in the item's normalized unit, so an offer
 * can sit beside the product's prices; an unmapped one keeps the store's label and category.
 *
 * Offers are a view of the recent snapshots, not a ledger: each sync replaces the days inside
 * its window (a re-capture or a wider bundle changes them) and drops days past retention.
 */

export const offerSync = { windowDays: 3, retentionDays: 35 } as const;

const OFFER_COLUMNS = [
  "staging_id", "observed_on", "source_id", "market_id", "market_label", "row_ref", "label", "category", "pack_quantity", "pack_unit",
  "price_minor", "list_minor", "offer_minor", "pct", "kind", "audience", "offer_label", "max_quantity",
  "item_id", "normalized_unit", "normalized_list_minor", "normalized_offer_minor", "url", "image_path",
] as const;

type OfferSourceRow = {
  staging_id: string;
  source_date: string;
  source_id: string;
  market_id: string | null;
  source_market_label: string;
  source_row_ref: string;
  source_item_label: string;
  source_quantity: string;
  source_unit: string;
  min_value_minor: number;
  raw_json: string;
  item_id: string | null;
  normalized_unit: string | null;
  observed_min: number | null;
  normalized_min: number | null;
  page_url: string | null;
  image_path: string | null;
};

export type OfferSyncResult = { from: string; rows: number; mapped: number };

export async function syncOffers(database: OperationalDatabase, client: WarehouseClient, options: { now?: Date | undefined; windowDays?: number | undefined; batchSize?: number | undefined } = {}): Promise<OfferSyncResult> {
  const now = options.now ?? new Date();
  const from = shiftDay(now, -(options.windowDays ?? offerSync.windowDays));
  // The store items behind the offers (page link, stored picture) are brought up to date first, so a new offer has its link at once.
  syncStoreProducts(database, { days: options.windowDays ?? offerSync.windowDays, now });
  const rows = database
    .prepare(
      `SELECT staging.id AS staging_id, staging.source_date, publication.source_id, mapping.market_id, staging.source_market_label,
              staging.source_row_ref, staging.source_item_label, staging.source_quantity, staging.source_unit, staging.min_value_minor, staging.raw_json,
              observation.item_id, observation.normalized_unit, observation.min_value_minor AS observed_min, observation.normalized_min_value_minor AS normalized_min,
              product.page_url, CASE WHEN product.image_path IS NOT NULL THEN product.image_path END AS image_path
       FROM staging_observation staging
       JOIN source_artifact artifact ON artifact.id = staging.artifact_id
       JOIN source_publication publication ON publication.id = artifact.publication_id
       LEFT JOIN source_market_mapping mapping ON mapping.source_id = publication.source_id AND mapping.source_label = staging.source_market_label
       LEFT JOIN price_observation observation ON observation.staging_id = staging.id AND observation.status = 'active'
       LEFT JOIN store_product product ON product.source_id = publication.source_id AND product.row_ref = staging.source_row_ref
       WHERE staging.price_type = 'retail_online_store' AND staging.source_date >= ? AND staging.status != 'stale'
         AND json_extract(staging.raw_json, '$.offer.kind') IS NOT NULL`,
    )
    .all(from) as OfferSourceRow[];

  const values: unknown[][] = [];
  const seen = new Set<string>();
  let mapped = 0;
  for (const row of rows) {
    // One active observation per staging row is the rule; a second join row for the same staging id would break the primary key.
    if (seen.has(row.staging_id)) continue;
    const raw = JSON.parse(row.raw_json) as Record<string, unknown>;
    const offer = readOffer(raw);
    if (!offer) continue;
    seen.add(row.staging_id);
    // The observation's own ratio carries the pack to the item's unit, so the offer lands on the same scale as the product's prices.
    const scale = row.item_id && row.observed_min && row.normalized_min ? row.normalized_min / row.observed_min : null;
    if (scale !== null) mapped += 1;
    values.push([
      row.staging_id, row.source_date, row.source_id, row.market_id, row.source_market_label, row.source_row_ref, row.source_item_label,
      typeof raw.category === "string" && raw.category ? raw.category : null, row.source_quantity, row.source_unit,
      row.min_value_minor, offer.list_minor, offer.offer_minor, offer.pct, offer.kind, offer.audience, offer.label ?? null, offer.max_quantity ?? null,
      scale === null ? null : row.item_id, scale === null ? null : row.normalized_unit,
      scale === null ? null : Math.round(offer.list_minor * scale), scale === null ? null : Math.round(offer.offer_minor * scale),
      // The row's own link when it has one, else the last one known for the item; the picture only once a copy is stored.
      readStoreLinks(raw).url ?? row.page_url, storedImagePath(row.image_path),
    ]);
  }

  const batchSize = options.batchSize ?? 500;
  await client.transaction(async (tx) => {
    await tx.query("DELETE FROM store_offer WHERE observed_on >= $1 OR observed_on < $2", [from, shiftDay(now, -offerSync.retentionDays)]);
    for (let offset = 0; offset < values.length; offset += batchSize) {
      const batch = values.slice(offset, offset + batchSize);
      await tx.query(`INSERT INTO store_offer (${OFFER_COLUMNS.join(", ")}) VALUES ${valuesPlaceholders(batch.length, OFFER_COLUMNS.length)}`, batch.flat());
    }
  });
  return { from, rows: values.length, mapped };
}

/** A stored picture's path as images.ts writes it: `<source>/<two hex>/<sha256>.<ext>`; anything else is not one. */
export function storedImagePath(path: string | null): string | null {
  return path && /^[a-z0-9_]+\/[0-9a-f]{2}\/[0-9a-f]{64}\.(?:jpg|png|webp|gif|avif)$/u.test(path) ? path : null;
}

function shiftDay(date: Date, days: number): string {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}
