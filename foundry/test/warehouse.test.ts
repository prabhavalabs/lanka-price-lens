import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { openOperationalDatabase, type OperationalDatabase } from "../src/db.ts";
import { embeddedWarehouse, migrateWarehouse, renderReportMarkdown, syncWarehouse, warehouseReport, type WarehouseClient } from "../src/warehouse/index.ts";

function seededDatabase(): { database: OperationalDatabase; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "lpl-warehouse-"));
  const database = openOperationalDatabase(join(root, "operations.sqlite"));
  const now = "2026-09-04T01:00:00.000Z";
  database.exec(`
    INSERT INTO source (id, manifest_json, name, owner, landing_url, rights_status, reviewed_at, review_due_at, enabled, state, updated_at)
    VALUES ('harti', '{"attribution_text":"Source: HARTI"}', 'HARTI', 'HARTI', 'https://harti.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('keells', '{"adapter":{"kind":"keells_api","settings":{}},"attribution_text":"Source: Keells"}', 'Keells', 'JKH', 'https://keells.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}');
    INSERT INTO market (id, type, label_en, scope_note) VALUES ('market_dambulla', 'wholesale_market', 'Dambulla', 'test'), ('market_keells_online', 'online_store', 'Keells Online', 'test');
    INSERT INTO product (id, category, canonical_label_en) VALUES ('product_carrot', 'vegetable', 'Carrot');
    INSERT INTO item (id, product_id, entity_type, canonical_label_en) VALUES ('item_carrot', 'product_carrot', 'commodity', 'Carrot');
    INSERT INTO unit_conversion_rule (id, source_unit, normalized_unit, factor_numerator, factor_denominator, rounding_mode, mapping_version) VALUES ('unit_kg_exact', 'kg', 'kg', 1, 1, 'half_away_from_zero', 'v1');
    INSERT INTO source_item_mapping (source_id, source_label, item_id, mapping_version, reviewed_by, reviewed_at, evidence_ref) VALUES ('harti', 'Carrot', 'item_carrot', 'v1', 'tests', '2026-09-01', 'docs'), ('keells', 'Carrot', 'item_carrot', 'v1', 'tests', '2026-09-01', 'docs');
    INSERT INTO source_publication (id, source_id, source_publication_key, title, published_at, observed_from, observed_to, landing_url, download_url, status, first_seen_at, last_seen_at)
    VALUES ('pub_h1', 'harti', 'h1', 'Bulletin 1', '2026-09-01T00:00:00.000Z', '2026-09-01', '2026-09-01', 'https://harti.example', 'https://harti.example/1.pdf', 'canonicalized', '${now}', '${now}'),
           ('pub_k1', 'keells', 'snapshot_2026-09-02', 'Keells snapshot', '2026-09-02T00:00:00.000Z', '2026-09-02', '2026-09-02', 'https://keells.example', 'snapshot://keells/2026-09-02', 'canonicalized', '${now}', '${now}');
    INSERT INTO ingest_run (id, source_id, trigger, status, started_at, heartbeat_at, lease_expires_at) VALUES ('run_1', 'harti', 'manual', 'succeeded', '${now}', '${now}', '${now}');
    INSERT INTO source_artifact (id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status) VALUES ('art_1', 'pub_h1', 'u', 'u', '${now}', 'application/pdf', 10, 'abc', 'canonicalized'), ('art_2', 'pub_k1', 'u', 'u', '${now}', 'application/json', 10, 'def', 'canonicalized');
    INSERT INTO staging_observation (id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label, source_date, price_type, currency, source_quantity, source_unit, min_value_minor, max_value_minor, status, raw_json)
    VALUES ('stg_1', 'run_1', 'art_1', 'r1', 'Carrot', 'Dambulla', '2026-09-01', 'wholesale_observed', 'LKR', '1', 'kg', 20000, 24000, 'canonicalized', '{}'),
           ('stg_2', 'run_1', 'art_2', 'r2', 'Carrot', 'Keells Online', '2026-09-02', 'retail_online_store', 'LKR', '1', 'kg', 36000, 36000, 'canonicalized', '{}');
  `);
  const insert = database.prepare(
    `INSERT INTO price_observation (id, run_id, staging_id, source_publication_id, source_artifact_id, item_id, market_id, price_type, currency, value_kind,
       min_value_minor, max_value_minor, normalized_min_value_minor, normalized_max_value_minor, source_quantity, source_unit, normalized_quantity, normalized_unit,
       conversion_rule_id, observed_from, observed_to, source_row_ref, confidence, comparability_key, lineage_key, effective_key, parser_version, mapping_version, status, created_at)
     VALUES (?, 'run_1', ?, ?, ?, 'item_carrot', ?, ?, 'LKR', ?, ?, ?, ?, ?, '1', 'kg', '1', 'kg', 'unit_kg_exact', ?, ?, ?, 'high', ?, ?, ?, 'p@1', 'v1', 'active', ?)`,
  );
  insert.run("obs_1", "stg_1", "pub_h1", "art_1", "market_dambulla", "wholesale_observed", "range", 20000, 24000, 20000, 24000, "2026-09-01", "2026-09-01", "r1", "cmp_1", "lin_1", "eff_1", "2026-09-01T02:00:00.000Z");
  insert.run("obs_2", "stg_2", "pub_k1", "art_2", "market_keells_online", "retail_online_store", "point", 36000, 36000, 36000, 36000, "2026-09-02", "2026-09-02", "r2", "cmp_2", "lin_2", "eff_2", "2026-09-02T02:00:00.000Z");
  return { database, cleanup: () => { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

async function count(client: WarehouseClient, sql: string, params: unknown[] = []): Promise<number> {
  return Number((await client.query<{ count: string }>(sql, params))[0]!.count);
}

test("warehouse schema migrates once and stays idempotent", async () => {
  const client = await embeddedWarehouse();
  try {
    assert.deepEqual(await migrateWarehouse(client), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(await migrateWarehouse(client), []);
    const tables = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    for (const expected of ["source", "market", "product", "item", "unit_rule", "publication", "price_observation", "sync_state", "schema_migration"]) {
      assert.ok(tables.some((table) => table.table_name === expected), `table ${expected}`);
    }
    const indexes = await client.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename = 'price_observation'");
    assert.ok(indexes.some((index) => index.indexname === "price_observation_series_idx"));
  } finally {
    await client.close();
  }
});

test("sync copies the canonical layer, resumes from its cursor, and propagates supersession", async () => {
  const { database, cleanup } = seededDatabase();
  const client = await embeddedWarehouse();
  try {
    const first = await syncWarehouse(database, client, { batchSize: 1 });
    assert.deepEqual(first.migrations, [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(first.references, { source: 2, market: 2, product: 1, item: 1, unit_rule: 1, publication: 2, item_alias: 2 });
    assert.equal(first.observations.upserted, 2);
    assert.equal(first.observations.batches, 2, "batches follow the batch size");
    assert.deepEqual(first.refreshed, ["daily_item_price", "latest_item_price"]);
    assert.equal(await count(client, "SELECT COUNT(*) AS count FROM price_observation WHERE status = 'active'"), 2);
    const sources = await client.query<{ id: string; kind: string; attribution_text: string }>("SELECT id, kind, attribution_text FROM source ORDER BY id");
    assert.deepEqual(sources, [{ id: "harti", kind: "pdf_bulletin", attribution_text: "Source: HARTI" }, { id: "keells", kind: "retail_snapshot", attribution_text: "Source: Keells" }]);
    const latest = await client.query<{ market_id: string; mid_minor: string; observed_on: string }>("SELECT market_id, mid_minor::TEXT, observed_on::TEXT FROM latest_item_price WHERE item_id = 'item_carrot' ORDER BY market_id");
    assert.deepEqual(latest, [{ market_id: "market_dambulla", mid_minor: "22000", observed_on: "2026-09-01" }, { market_id: "market_keells_online", mid_minor: "36000", observed_on: "2026-09-02" }]);

    const second = await syncWarehouse(database, client);
    assert.equal(second.observations.scanned, 0, "nothing changed, nothing sent");
    assert.deepEqual(second.observations.cursor, first.observations.cursor);

    // A revision in the operational store: the old row is superseded (stamped) and a replacement inserted.
    database.prepare("UPDATE price_observation SET status = 'superseded', updated_at = '2026-09-03T02:00:00.000Z' WHERE id = 'obs_1'").run();
    database
      .prepare(
        `INSERT INTO price_observation (id, run_id, staging_id, source_publication_id, source_artifact_id, item_id, market_id, price_type, currency, value_kind,
           min_value_minor, max_value_minor, normalized_min_value_minor, normalized_max_value_minor, source_quantity, source_unit, normalized_quantity, normalized_unit,
           conversion_rule_id, observed_from, observed_to, source_row_ref, confidence, comparability_key, lineage_key, effective_key, parser_version, mapping_version, status, supersedes_id, created_at)
         VALUES ('obs_3', 'run_1', 'stg_1', 'pub_h1', 'art_1', 'item_carrot', 'market_dambulla', 'wholesale_observed', 'LKR', 'range', 21000, 25000, 21000, 25000, '1', 'kg', '1', 'kg', 'unit_kg_exact', '2026-09-01', '2026-09-01', 'r1', 'high', 'cmp_1', 'lin_1b', 'eff_1', 'p@1', 'v2', 'active', 'obs_1', '2026-09-03T02:00:00.000Z')`,
      )
      .run();
    database.prepare("UPDATE price_observation SET superseded_by_id = 'obs_3', updated_at = '2026-09-03T02:00:00.000Z' WHERE id = 'obs_1'").run();
    const third = await syncWarehouse(database, client);
    assert.equal(third.observations.scanned, 2, "the superseded row and its replacement are both resent");
    const statuses = await client.query<{ id: string; status: string; superseded_by_id: string | null }>("SELECT id, status, superseded_by_id FROM price_observation WHERE item_id = 'item_carrot' AND market_id = 'market_dambulla' ORDER BY id");
    assert.deepEqual(statuses, [{ id: "obs_1", status: "superseded", superseded_by_id: "obs_3" }, { id: "obs_3", status: "active", superseded_by_id: null }]);
    assert.equal(await count(client, "SELECT COUNT(*) AS count FROM (SELECT effective_key FROM price_observation WHERE status = 'active' GROUP BY effective_key HAVING COUNT(*) > 1) d"), 0);
    const refreshed = await client.query<{ mid_minor: string }>("SELECT mid_minor::TEXT FROM latest_item_price WHERE item_id = 'item_carrot' AND market_id = 'market_dambulla'");
    assert.deepEqual(refreshed, [{ mid_minor: "23000" }], "aggregates follow the revision");

    const full = await syncWarehouse(database, client, { full: true });
    assert.equal(full.observations.scanned, 3, "a full sync resends everything and stays consistent");
    assert.equal(await count(client, "SELECT COUNT(*) AS count FROM price_observation"), 3);
  } finally {
    await client.close();
    cleanup();
  }
});

test("validation report summarises coverage and integrity", async () => {
  const { database, cleanup } = seededDatabase();
  const client = await embeddedWarehouse();
  try {
    await syncWarehouse(database, client);
    const report = await warehouseReport(client, new Date("2026-09-04T00:00:00Z"));
    assert.equal(report.totals.active, 2);
    assert.equal(report.totals.first_day, "2026-09-01");
    assert.equal(report.totals.last_day, "2026-09-02");
    assert.deepEqual(report.sources.map((source) => [source.source_id, source.active, source.days]), [["harti", 1, 1], ["keells", 1, 1]]);
    assert.equal(report.checks.duplicate_active_effective_keys, 0);
    assert.equal(report.checks.orphan_publications, 0);
    assert.equal(report.staples.find((staple) => staple.item_id === "item_carrot")?.markets.length, 2);
    const markdown = renderReportMarkdown(report);
    assert.match(markdown, /## Sources/u);
    assert.match(markdown, /market_keells_online \| retail_online_store \| 2026-09-02 \| 360 \| kg/u);
  } finally {
    await client.close();
    cleanup();
  }
});
