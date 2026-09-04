import type { WarehouseClient } from "./client.ts";

/**
 * The PostgreSQL warehouse mirrors the canonical layer of the operational SQLite
 * store (sources, markets, products, items, unit rules, publications, price
 * observations) and adds the indexes and aggregates that serving and reporting
 * need. Migrations are applied in order and recorded in schema_migration, so
 * `warehouse migrate` is safe to run any number of times.
 */
export const warehouseMigrations: ReadonlyArray<{ version: number; name: string; statements: string[] }> = [
  {
    version: 1,
    name: "canonical mirror",
    statements: [
      `CREATE TABLE IF NOT EXISTS source (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('pdf_bulletin', 'retail_snapshot')),
        rights_status TEXT NOT NULL,
        attribution_text TEXT,
        landing_url TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`,
      `CREATE TABLE IF NOT EXISTS market (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        label_en TEXT NOT NULL,
        label_si TEXT,
        label_ta TEXT,
        pcode TEXT,
        scope_note TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      )`,
      `CREATE TABLE IF NOT EXISTS product (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        label_en TEXT NOT NULL,
        label_si TEXT,
        label_ta TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      )`,
      `CREATE TABLE IF NOT EXISTS item (
        id TEXT PRIMARY KEY,
        product_id TEXT REFERENCES product(id),
        entity_type TEXT NOT NULL,
        label_en TEXT NOT NULL,
        label_si TEXT,
        label_ta TEXT,
        variety TEXT,
        origin TEXT,
        size TEXT,
        grade TEXT,
        status TEXT NOT NULL DEFAULT 'active'
      )`,
      `CREATE INDEX IF NOT EXISTS item_product_idx ON item (product_id)`,
      `CREATE TABLE IF NOT EXISTS unit_rule (
        id TEXT PRIMARY KEY,
        source_unit TEXT NOT NULL,
        normalized_unit TEXT NOT NULL,
        factor_numerator INTEGER NOT NULL,
        factor_denominator INTEGER NOT NULL,
        rounding_mode TEXT NOT NULL,
        mapping_version TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS publication (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES source(id),
        publication_key TEXT NOT NULL,
        title TEXT NOT NULL,
        published_at TIMESTAMPTZ,
        observed_from DATE,
        observed_to DATE,
        landing_url TEXT NOT NULL,
        download_url TEXT NOT NULL,
        status TEXT NOT NULL,
        UNIQUE (source_id, publication_key)
      )`,
      `CREATE INDEX IF NOT EXISTS publication_source_published_idx ON publication (source_id, published_at DESC)`,
      `CREATE TABLE IF NOT EXISTS price_observation (
        id TEXT PRIMARY KEY,
        observed_on DATE NOT NULL,
        observed_to DATE NOT NULL,
        item_id TEXT NOT NULL REFERENCES item(id),
        market_id TEXT NOT NULL REFERENCES market(id),
        source_id TEXT NOT NULL REFERENCES source(id),
        publication_id TEXT NOT NULL REFERENCES publication(id),
        price_type TEXT NOT NULL,
        currency CHAR(3) NOT NULL,
        value_kind TEXT NOT NULL,
        min_value_minor BIGINT NOT NULL CHECK (min_value_minor > 0),
        max_value_minor BIGINT NOT NULL CHECK (max_value_minor >= min_value_minor),
        normalized_min_value_minor BIGINT NOT NULL CHECK (normalized_min_value_minor > 0),
        normalized_max_value_minor BIGINT NOT NULL CHECK (normalized_max_value_minor >= normalized_min_value_minor),
        mid_value_minor BIGINT GENERATED ALWAYS AS ((normalized_min_value_minor + normalized_max_value_minor) / 2) STORED,
        source_quantity TEXT NOT NULL,
        source_unit TEXT NOT NULL,
        normalized_quantity NUMERIC NOT NULL,
        normalized_unit TEXT NOT NULL,
        conversion_rule_id TEXT,
        source_row_ref TEXT NOT NULL,
        confidence TEXT NOT NULL,
        comparability_key TEXT NOT NULL,
        lineage_key TEXT NOT NULL,
        effective_key TEXT,
        parser_version TEXT NOT NULL,
        mapping_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'withdrawn')),
        supersedes_id TEXT,
        superseded_by_id TEXT,
        revision_reason TEXT,
        source_published_at TIMESTAMPTZ,
        source_fetched_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      )`,
      // The serving query: one item in one market over time, active rows only.
      `CREATE INDEX IF NOT EXISTS price_observation_series_idx ON price_observation (item_id, market_id, price_type, observed_on DESC) WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS price_observation_day_idx ON price_observation (observed_on, price_type) WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS price_observation_market_idx ON price_observation (market_id, observed_on DESC) WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS price_observation_source_idx ON price_observation (source_id, observed_on DESC)`,
      `CREATE INDEX IF NOT EXISTS price_observation_publication_idx ON price_observation (publication_id)`,
      `CREATE INDEX IF NOT EXISTS price_observation_effective_idx ON price_observation (effective_key) WHERE status = 'active'`,
      `CREATE INDEX IF NOT EXISTS price_observation_updated_idx ON price_observation (updated_at)`,
      `CREATE TABLE IF NOT EXISTS sync_state (
        name TEXT PRIMARY KEY,
        cursor_stamp TEXT,
        cursor_id TEXT,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        rows_synced BIGINT NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    version: 2,
    name: "serving aggregates",
    statements: [
      // One row per item, market, source, price type, and day; the grain reports and charts read.
      `CREATE MATERIALIZED VIEW IF NOT EXISTS daily_item_price AS
        SELECT item_id, market_id, source_id, price_type, observed_on, normalized_unit,
               MIN(normalized_min_value_minor) AS low_minor,
               MAX(normalized_max_value_minor) AS high_minor,
               ROUND(AVG(mid_value_minor))::BIGINT AS mid_minor,
               COUNT(*)::INTEGER AS observations
        FROM price_observation
        WHERE status = 'active'
        GROUP BY item_id, market_id, source_id, price_type, observed_on, normalized_unit`,
      `CREATE UNIQUE INDEX IF NOT EXISTS daily_item_price_uidx ON daily_item_price (item_id, market_id, source_id, price_type, observed_on, normalized_unit)`,
      `CREATE INDEX IF NOT EXISTS daily_item_price_day_idx ON daily_item_price (observed_on)`,
      // The newest price per item, market, and price type: what a consumer screen shows first.
      `CREATE MATERIALIZED VIEW IF NOT EXISTS latest_item_price AS
        SELECT DISTINCT ON (item_id, market_id, price_type)
               item_id, market_id, source_id, price_type, observed_on, normalized_unit, low_minor, high_minor, mid_minor
        FROM daily_item_price
        ORDER BY item_id, market_id, price_type, observed_on DESC`,
      `CREATE UNIQUE INDEX IF NOT EXISTS latest_item_price_uidx ON latest_item_price (item_id, market_id, price_type)`,
    ],
  },
  {
    version: 3,
    name: "source cadence",
    statements: [`ALTER TABLE source ADD COLUMN IF NOT EXISTS cadence TEXT`],
  },
];

export const materializedViews = ["daily_item_price", "latest_item_price"] as const;

export async function migrateWarehouse(client: WarehouseClient): Promise<number[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const applied = new Set((await client.query<{ version: number }>("SELECT version FROM schema_migration")).map((row) => Number(row.version)));
  const newlyApplied: number[] = [];
  for (const migration of warehouseMigrations) {
    if (applied.has(migration.version)) continue;
    await client.transaction(async (tx) => {
      for (const statement of migration.statements) await tx.query(statement);
      await tx.query("INSERT INTO schema_migration (version, name) VALUES ($1, $2)", [migration.version, migration.name]);
    });
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}

export async function refreshAggregates(client: WarehouseClient): Promise<string[]> {
  for (const view of materializedViews) await client.query(`REFRESH MATERIALIZED VIEW ${view}`);
  return [...materializedViews];
}
