import type { OperationalDatabase } from "../db.ts";
import { valuesPlaceholders, type WarehouseClient } from "./client.ts";
import { migrateWarehouse, refreshAggregates } from "./schema.ts";

export type SyncLog = (level: "info" | "warning", message: string, data?: Record<string, unknown>) => void;

export type SyncOptions = {
  /** Rows per upsert statement. 500 keeps well under PostgreSQL's parameter limit for the widest table. */
  batchSize?: number;
  /** Ignore the saved cursor and re-send every observation (idempotent; used after schema changes). */
  full?: boolean;
  log?: SyncLog;
  now?: Date;
};

export type SyncResult = {
  migrations: number[];
  references: Record<string, number>;
  observations: { scanned: number; upserted: number; batches: number; cursor: { stamp: string; id: string } | null };
  refreshed: string[];
  durationMs: number;
};

const OBSERVATION_COLUMNS = [
  "id", "observed_on", "observed_to", "item_id", "market_id", "source_id", "publication_id", "price_type", "currency", "value_kind",
  "min_value_minor", "max_value_minor", "normalized_min_value_minor", "normalized_max_value_minor",
  "source_quantity", "source_unit", "normalized_quantity", "normalized_unit", "conversion_rule_id", "source_row_ref", "confidence",
  "comparability_key", "lineage_key", "effective_key", "parser_version", "mapping_version", "status", "supersedes_id", "superseded_by_id",
  "revision_reason", "source_published_at", "source_fetched_at", "created_at", "updated_at",
] as const;

type ObservationRow = {
  id: string;
  observed_from: string;
  observed_to: string;
  item_id: string;
  market_id: string;
  source_id: string;
  source_publication_id: string;
  price_type: string;
  currency: string;
  value_kind: string;
  min_value_minor: number;
  max_value_minor: number;
  normalized_min_value_minor: number;
  normalized_max_value_minor: number;
  source_quantity: string;
  source_unit: string;
  normalized_quantity: string;
  normalized_unit: string;
  conversion_rule_id: string | null;
  source_row_ref: string;
  confidence: string;
  comparability_key: string;
  lineage_key: string;
  effective_key: string | null;
  parser_version: string;
  mapping_version: string;
  status: string;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  revision_reason: string | null;
  source_published_at: string | null;
  source_fetched_at: string | null;
  created_at: string;
  stamp: string;
};

/**
 * Copies the canonical layer from the operational SQLite store into the
 * PostgreSQL warehouse. Reference tables are upserted whole (they are small);
 * observations are streamed in (change stamp, id) order from a saved cursor, so
 * a rerun only sends what changed and an interrupted run resumes where it
 * stopped. Every batch is one transaction and every statement is an upsert, so
 * the sync is idempotent.
 */
export async function syncWarehouse(database: OperationalDatabase, client: WarehouseClient, options: SyncOptions = {}): Promise<SyncResult> {
  const started = Date.now();
  const log = options.log ?? (() => undefined);
  const batchSize = options.batchSize ?? 500;
  const migrations = await migrateWarehouse(client);
  if (migrations.length) log("info", "Warehouse schema migrated", { versions: migrations });

  const references = await syncReferences(database, client, batchSize);
  log("info", "Reference tables synced", references);

  const state = options.full
    ? null
    : (await client.query<{ cursor_stamp: string | null; cursor_id: string | null }>("SELECT cursor_stamp, cursor_id FROM sync_state WHERE name = 'price_observation'"))[0] ?? null;
  let cursor = state?.cursor_stamp ? { stamp: state.cursor_stamp, id: state.cursor_id ?? "" } : { stamp: "", id: "" };
  const select = database.prepare(
    `SELECT observation.*, publication.source_id, COALESCE(observation.updated_at, observation.created_at) AS stamp
     FROM price_observation observation
     JOIN source_publication publication ON publication.id = observation.source_publication_id
     WHERE (COALESCE(observation.updated_at, observation.created_at), observation.id) > (?, ?)
     ORDER BY stamp, observation.id LIMIT ?`,
  );
  let scanned = 0;
  let upserted = 0;
  let batches = 0;
  for (;;) {
    const rows = select.all(cursor.stamp, cursor.id, batchSize) as ObservationRow[];
    if (!rows.length) break;
    // Rows that stop being active go first so a replacement row never coexists with its predecessor as active within the batch.
    rows.sort((left, right) => Number(left.status === "active") - Number(right.status === "active") || left.stamp.localeCompare(right.stamp) || left.id.localeCompare(right.id));
    const last = rows.reduce((newest, row) => (row.stamp > newest.stamp || (row.stamp === newest.stamp && row.id > newest.id) ? row : newest), rows[0]!);
    await withRetry(() =>
      client.transaction(async (tx) => {
        await upsertObservations(tx, rows);
        await tx.query(
          `INSERT INTO sync_state (name, cursor_stamp, cursor_id, synced_at, rows_synced) VALUES ('price_observation', $1, $2, now(), $3)
           ON CONFLICT (name) DO UPDATE SET cursor_stamp = EXCLUDED.cursor_stamp, cursor_id = EXCLUDED.cursor_id, synced_at = EXCLUDED.synced_at,
             rows_synced = sync_state.rows_synced + EXCLUDED.rows_synced`,
          [last.stamp, last.id, rows.length],
        );
      }),
    );
    scanned += rows.length;
    upserted += rows.length;
    batches += 1;
    cursor = { stamp: last.stamp, id: last.id };
    if (batches % 20 === 0) log("info", "Observation batches synced", { batches, rows: scanned });
    if (rows.length < batchSize) break;
  }
  log("info", "Observations synced", { scanned, upserted, batches });

  const refreshed = await refreshAggregates(client);
  return { migrations, references, observations: { scanned, upserted, batches, cursor: cursor.stamp ? cursor : null }, refreshed, durationMs: Date.now() - started };
}

async function syncReferences(database: OperationalDatabase, client: WarehouseClient, batchSize: number): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  const sources = (database.prepare("SELECT id, name, owner, landing_url, rights_status, enabled, manifest_json FROM source").all() as Array<{ id: string; name: string; owner: string; landing_url: string; rights_status: string; enabled: number; manifest_json: string }>).map((row) => {
    const manifest = JSON.parse(row.manifest_json) as { adapter?: unknown; attribution_text?: string | null; expected_cadence?: string | null };
    return [row.id, row.name, row.owner, manifest.adapter ? "retail_snapshot" : "pdf_bulletin", row.rights_status, manifest.attribution_text ?? null, row.landing_url, Boolean(row.enabled), manifest.expected_cadence ?? null];
  });
  counts.source = await upsertRows(client, "source", ["id", "name", "owner", "kind", "rights_status", "attribution_text", "landing_url", "enabled", "cadence"], sources, batchSize, "updated_at = now()");

  const markets = (database.prepare("SELECT id, type, label_en, label_si, label_ta, pcode, scope_note, status FROM market").all() as Array<Record<string, unknown>>).map((row) => [row.id, row.type, row.label_en, row.label_si, row.label_ta, row.pcode, row.scope_note, row.status]);
  counts.market = await upsertRows(client, "market", ["id", "type", "label_en", "label_si", "label_ta", "pcode", "scope_note", "status"], markets, batchSize);

  const products = (database.prepare("SELECT id, category, canonical_label_en, canonical_label_si, canonical_label_ta, status FROM product").all() as Array<Record<string, unknown>>).map((row) => [row.id, row.category, row.canonical_label_en, row.canonical_label_si, row.canonical_label_ta, row.status]);
  counts.product = await upsertRows(client, "product", ["id", "category", "label_en", "label_si", "label_ta", "status"], products, batchSize);

  const items = (database.prepare("SELECT id, product_id, entity_type, canonical_label_en, canonical_label_si, canonical_label_ta, variety, origin, size, grade, status FROM item").all() as Array<Record<string, unknown>>).map((row) => [row.id, row.product_id, row.entity_type, row.canonical_label_en, row.canonical_label_si, row.canonical_label_ta, row.variety, row.origin, row.size, row.grade, row.status]);
  counts.item = await upsertRows(client, "item", ["id", "product_id", "entity_type", "label_en", "label_si", "label_ta", "variety", "origin", "size", "grade", "status"], items, batchSize);

  const units = (database.prepare("SELECT id, source_unit, normalized_unit, factor_numerator, factor_denominator, rounding_mode, mapping_version FROM unit_conversion_rule").all() as Array<Record<string, unknown>>).map((row) => [row.id, row.source_unit, row.normalized_unit, row.factor_numerator, row.factor_denominator, row.rounding_mode, row.mapping_version]);
  counts.unit_rule = await upsertRows(client, "unit_rule", ["id", "source_unit", "normalized_unit", "factor_numerator", "factor_denominator", "rounding_mode", "mapping_version"], units, batchSize);

  const publications = (database.prepare("SELECT id, source_id, source_publication_key, title, published_at, observed_from, observed_to, landing_url, download_url, status FROM source_publication").all() as Array<Record<string, unknown>>).map((row) => [row.id, row.source_id, row.source_publication_key, row.title, row.published_at, row.observed_from, row.observed_to, row.landing_url, row.download_url, row.status]);
  counts.publication = await upsertRows(client, "publication", ["id", "source_id", "publication_key", "title", "published_at", "observed_from", "observed_to", "landing_url", "download_url", "status"], publications, batchSize);

  const aliases = (database.prepare("SELECT source_id, source_label, item_id FROM source_item_mapping").all() as Array<Record<string, unknown>>).map((row) => [row.source_id, row.source_label, row.item_id]);
  counts.item_alias = await upsertAliases(client, aliases, batchSize);
  return counts;
}

async function upsertAliases(client: WarehouseClient, rows: unknown[][], batchSize: number): Promise<number> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    await withRetry(() =>
      client.query(
        `INSERT INTO item_alias (source_id, label, item_id) VALUES ${valuesPlaceholders(batch.length, 3)}
         ON CONFLICT (source_id, label) DO UPDATE SET item_id = EXCLUDED.item_id`,
        batch.flat(),
      ),
    );
  }
  return rows.length;
}

async function upsertRows(client: WarehouseClient, table: string, columns: string[], rows: unknown[][], batchSize: number, extraSet = ""): Promise<number> {
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const updates = columns.filter((column) => column !== "id").map((column) => `${column} = EXCLUDED.${column}`);
    if (extraSet) updates.push(extraSet);
    await withRetry(() =>
      client.query(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${valuesPlaceholders(batch.length, columns.length)}
         ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
        batch.flat(),
      ),
    );
  }
  return rows.length;
}

async function upsertObservations(tx: WarehouseClient, rows: ObservationRow[]): Promise<void> {
  const values = rows.flatMap((row) => [
    row.id,
    row.observed_from,
    row.observed_to,
    row.item_id,
    row.market_id,
    row.source_id,
    row.source_publication_id,
    row.price_type,
    row.currency,
    row.value_kind,
    row.min_value_minor,
    row.max_value_minor,
    row.normalized_min_value_minor,
    row.normalized_max_value_minor,
    row.source_quantity,
    row.source_unit,
    row.normalized_quantity,
    row.normalized_unit,
    row.conversion_rule_id,
    row.source_row_ref,
    row.confidence,
    row.comparability_key,
    row.lineage_key,
    row.effective_key,
    row.parser_version,
    row.mapping_version,
    row.status,
    row.supersedes_id,
    row.superseded_by_id,
    row.revision_reason,
    row.source_published_at,
    row.source_fetched_at,
    row.created_at,
    row.stamp,
  ]);
  const updates = OBSERVATION_COLUMNS.filter((column) => column !== "id").map((column) => `${column} = EXCLUDED.${column}`);
  await tx.query(
    `INSERT INTO price_observation (${OBSERVATION_COLUMNS.join(", ")}) VALUES ${valuesPlaceholders(rows.length, OBSERVATION_COLUMNS.length)}
     ON CONFLICT (id) DO UPDATE SET ${updates.join(", ")}`,
    values,
  );
}

/** Transient failures (connection drops, deadlocks, serialization) are retried with growing pauses; anything else surfaces at once. */
async function withRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string }).code ?? "";
      const transient = ["40001", "40P01", "57P01", "08006", "08001", "08003", "ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(code);
      if (!transient || attempt === attempts) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("WAREHOUSE_SYNC_FAILED");
}
