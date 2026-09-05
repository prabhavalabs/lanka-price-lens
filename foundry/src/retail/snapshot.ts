import { z } from "zod";

import type { OperationalDatabase } from "../db.ts";
import type { NormalizedRecord } from "./types.ts";

/**
 * A snapshot as a portable file: the normalised records of one retailer on one
 * trading day. Exported from the store that captured it and imported into another
 * (a laptop that a retailer's bot protection accepts feeding the production
 * server it refuses), where it is filed, deduplicated, and priced exactly like a
 * live capture.
 */

export const snapshotRecordSchema = z.object({
  rowRef: z.string().min(1).max(200),
  itemLabel: z.string().min(1).max(500),
  marketLabel: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  sourceQuantity: z.string().regex(/^\d+(?:\.\d+)?$/u),
  sourceUnit: z.string().min(1).max(20),
  minValueMinor: z.number().int().positive(),
  maxValueMinor: z.number().int().positive(),
  raw: z.record(z.string(), z.unknown()).default({}),
});

export const snapshotFileSchema = z.object({
  schema_version: z.literal("1.0.0"),
  source_id: z.string().min(1),
  capture_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  captured_at: z.string().min(1),
  adapter: z.string().min(1),
  records: z.array(snapshotRecordSchema).min(1).max(100_000),
});

export type SnapshotFile = z.infer<typeof snapshotFileSchema>;

/** The latest complete snapshot a source stored for a trading day, rebuilt from its staging rows. */
export function exportSnapshot(database: OperationalDatabase, sourceId: string, captureDate: string, options: { raw?: boolean | undefined } = {}): SnapshotFile | null {
  const artifact = database
    .prepare(
      `SELECT artifact.id, artifact.fetched_at, source.manifest_json
       FROM source_artifact artifact
       JOIN source_publication publication ON publication.id = artifact.publication_id
       JOIN source ON source.id = publication.source_id
       WHERE publication.source_id = ? AND publication.source_publication_key = ?
         AND EXISTS (SELECT 1 FROM staging_observation so WHERE so.artifact_id = artifact.id AND so.status != 'stale')
       ORDER BY artifact.fetched_at DESC LIMIT 1`,
    )
    .get(sourceId, `snapshot_${captureDate}`) as { id: string; fetched_at: string; manifest_json: string } | undefined;
  if (!artifact) return null;
  const rows = database
    .prepare(
      `SELECT source_row_ref, source_item_label, source_market_label, source_date, source_quantity, source_unit, min_value_minor, max_value_minor, raw_json
       FROM staging_observation WHERE artifact_id = ? AND status != 'stale' ORDER BY source_row_ref, source_market_label`,
    )
    .all(artifact.id) as Array<{ source_row_ref: string; source_item_label: string; source_market_label: string; source_date: string; source_quantity: string; source_unit: string; min_value_minor: number; max_value_minor: number; raw_json: string }>;
  const manifest = JSON.parse(artifact.manifest_json) as { adapter?: { kind?: string } };
  const records: NormalizedRecord[] = rows.map((row) => ({
    rowRef: row.source_row_ref,
    itemLabel: row.source_item_label,
    marketLabel: row.source_market_label,
    date: row.source_date,
    sourceQuantity: row.source_quantity,
    sourceUnit: row.source_unit,
    minValueMinor: row.min_value_minor,
    maxValueMinor: row.max_value_minor,
    raw: options.raw ? (safeJson(row.raw_json) as Record<string, unknown>) : {},
  }));
  return { schema_version: "1.0.0", source_id: sourceId, capture_date: captureDate, captured_at: artifact.fetched_at, adapter: manifest.adapter?.kind ?? "unknown", records };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
