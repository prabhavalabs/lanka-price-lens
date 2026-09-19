import type { OperationalDatabase } from "../db.ts";
import { readStoreLinks } from "./links.ts";

/**
 * The store items that have been on offer, one row per store and the store's own id for the
 * item: the page the store shows it on, the original address of its picture, and (through
 * images.ts) the copy kept on this server. It is filled from the retail staging rows that carry
 * an offer, so the table grows with the deals rather than with the stores' whole catalogues.
 *
 * A picture is fetched once. When a store gives an item a new picture address the row goes back
 * to `pending` and keeps showing the old copy until the new one is stored.
 */

export type StoreProductSync = { scanned: number; added: number; updated: number; repictured: number };

type StagedRow = { source_id: string; source_row_ref: string; source_item_label: string; raw_json: string };
type Existing = { page_url: string | null; image_source_url: string | null; label: string };

export function syncStoreProducts(database: OperationalDatabase, options: { days?: number | undefined; sourceId?: string | undefined; now?: Date | undefined } = {}): StoreProductSync {
  const now = options.now ?? new Date();
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (options.days ?? 3));
  const rows = database
    .prepare(
      `SELECT publication.source_id, staging.source_row_ref, staging.source_item_label, staging.raw_json
       FROM staging_observation staging
       JOIN source_artifact artifact ON artifact.id = staging.artifact_id
       JOIN source_publication publication ON publication.id = artifact.publication_id
       WHERE staging.price_type = 'retail_online_store' AND staging.source_date >= ? AND staging.status != 'stale'
         AND json_extract(staging.raw_json, '$.offer.kind') IS NOT NULL ${options.sourceId ? "AND publication.source_id = ?" : ""}
       ORDER BY staging.source_date`,
    )
    .all(...[from.toISOString().slice(0, 10), ...(options.sourceId ? [options.sourceId] : [])]) as StagedRow[];

  const find = database.prepare("SELECT page_url, image_source_url, label FROM store_product WHERE source_id = ? AND row_ref = ?");
  const insert = database.prepare(
    `INSERT INTO store_product (source_id, row_ref, label, page_url, image_source_url, image_status, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const touch = database.prepare("UPDATE store_product SET label = ?, page_url = COALESCE(?, page_url), last_seen_at = ? WHERE source_id = ? AND row_ref = ?");
  const repicture = database.prepare(
    "UPDATE store_product SET image_source_url = ?, image_status = 'pending', image_attempts = 0, image_error = NULL, next_attempt_at = NULL WHERE source_id = ? AND row_ref = ?",
  );
  const stamp = now.toISOString();
  const result: StoreProductSync = { scanned: rows.length, added: 0, updated: 0, repictured: 0 };
  database.transaction(() => {
    for (const row of rows) {
      const links = readStoreLinks(safeJson(row.raw_json));
      const existing = find.get(row.source_id, row.source_row_ref) as Existing | undefined;
      if (!existing) {
        insert.run(row.source_id, row.source_row_ref, row.source_item_label, links.url, links.image, links.image ? "pending" : "none", stamp, stamp);
        result.added += 1;
        continue;
      }
      touch.run(row.source_item_label, links.url, stamp, row.source_id, row.source_row_ref);
      result.updated += 1;
      if (links.image && links.image !== existing.image_source_url) {
        repicture.run(links.image, row.source_id, row.source_row_ref);
        result.repictured += 1;
      }
    }
  })();
  return result;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
