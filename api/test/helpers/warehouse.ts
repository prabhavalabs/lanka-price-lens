import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { embeddedWarehouse, syncWarehouse } from "@lanka-pricelens/foundry/warehouse";

/** A small operational store (HARTI wholesale, two supermarkets, big onion and egg) and a warehouse synced from it, shared by the read-model tests. */
export function seed(database: ReturnType<typeof openOperationalDatabase>): void {
  const now = "2026-09-04T01:00:00.000Z";
  database.exec(`
    INSERT INTO source (id, manifest_json, name, owner, landing_url, rights_status, reviewed_at, review_due_at, enabled, state, updated_at)
    VALUES ('harti', '{"attribution_text":"Source: HARTI","expected_cadence":"daily"}', 'HARTI', 'HARTI', 'https://harti.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('keells', '{"adapter":{"kind":"keells_api","settings":{}},"expected_cadence":"daily"}', 'Keells', 'JKH', 'https://keells.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}'),
           ('cargills', '{"adapter":{"kind":"cargills_api","settings":{}},"expected_cadence":"daily"}', 'Cargills', 'Cargills', 'https://cargills.example', 'approved_permission', '2026-01-01', '2027-01-01', 1, 'healthy', '${now}');
    INSERT INTO market (id, type, label_en, scope_note) VALUES ('market_dambulla', 'wholesale_market', 'Dambulla', 't'), ('market_pettah', 'wholesale_market', 'Pettah', 't'), ('market_keells_online', 'online_store', 'Keells Online', 't'), ('market_cargills_online', 'online_store', 'Cargills Online', 't');
    INSERT INTO product (id, category, canonical_label_en) VALUES ('product_big_onion', 'vegetable', 'Big Onion'), ('product_egg', 'other', 'Egg');
    INSERT INTO item (id, product_id, entity_type, canonical_label_en, origin) VALUES ('item_big_onion_imported', 'product_big_onion', 'commodity', 'Big Onion', 'Imported'), ('item_big_onion', 'product_big_onion', 'commodity', 'Big Onion', NULL), ('item_egg', 'product_egg', 'commodity', 'Egg', NULL);
    INSERT INTO unit_conversion_rule (id, source_unit, normalized_unit, factor_numerator, factor_denominator, rounding_mode, mapping_version) VALUES ('unit_kg_exact', 'kg', 'kg', 1, 1, 'half_away_from_zero', 'v1');
    INSERT INTO source_item_mapping (source_id, source_label, item_id, mapping_version, reviewed_by, reviewed_at, evidence_ref)
    VALUES ('harti', 'B''Onion Imported', 'item_big_onion_imported', 'v1', 'tests', '2026-09-01', 'docs'), ('keells', 'Big Onions', 'item_big_onion', 'v1', 'tests', '2026-09-01', 'docs'), ('cargills', 'Big Onion', 'item_big_onion', 'v1', 'tests', '2026-09-01', 'docs');
    INSERT INTO source_publication (id, source_id, source_publication_key, title, published_at, observed_from, observed_to, landing_url, download_url, status, first_seen_at, last_seen_at)
    VALUES ('pub_h', 'harti', 'h1', 'Bulletin', '2026-09-03T00:00:00.000Z', '2026-09-03', '2026-09-03', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_k', 'keells', 'k1', 'Snapshot', '2026-09-04T00:00:00.000Z', '2026-09-04', '2026-09-04', 'u', 'u', 'canonicalized', '${now}', '${now}'),
           ('pub_c', 'cargills', 'c1', 'Snapshot', '2026-09-04T00:00:00.000Z', '2026-09-04', '2026-09-04', 'u', 'u', 'canonicalized', '${now}', '${now}');
    INSERT INTO ingest_run (id, source_id, trigger, status, started_at, heartbeat_at, lease_expires_at) VALUES ('run_1', 'harti', 'manual', 'succeeded', '${now}', '${now}', '${now}');
    INSERT INTO source_artifact (id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status)
    VALUES ('art_h', 'pub_h', 'u', 'u', '${now}', 'application/pdf', 1, 'a', 'canonicalized'), ('art_k', 'pub_k', 'u', 'u', '${now}', 'application/json', 1, 'b', 'canonicalized'), ('art_c', 'pub_c', 'u', 'u', '${now}', 'application/json', 1, 'c', 'canonicalized');
  `);
  const staging = database.prepare(
    `INSERT INTO staging_observation (id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label, source_date, price_type, currency, source_quantity, source_unit, min_value_minor, max_value_minor, status, raw_json)
     VALUES (?, 'run_1', ?, ?, 'x', ?, ?, ?, 'LKR', '1', 'kg', 1, 1, 'canonicalized', '{}')`,
  );
  const insert = database.prepare(
    `INSERT INTO price_observation (id, run_id, staging_id, source_publication_id, source_artifact_id, item_id, market_id, price_type, currency, value_kind,
       min_value_minor, max_value_minor, normalized_min_value_minor, normalized_max_value_minor, source_quantity, source_unit, normalized_quantity, normalized_unit,
       conversion_rule_id, observed_from, observed_to, source_row_ref, confidence, comparability_key, lineage_key, effective_key, parser_version, mapping_version, status, created_at)
     VALUES (?, 'run_1', ?, ?, ?, ?, ?, ?, 'LKR', 'point', ?, ?, ?, ?, '1', 'kg', '1', 'kg', 'unit_kg_exact', ?, ?, 'r', 'high', ?, ?, ?, 'p@1', 'v1', 'active', ?)`,
  );
  let sequence = 0;
  const add = (publication: string, artifact: string, item: string, market: string, priceType: string, day: string, rupees: number) => {
    sequence += 1;
    const minor = rupees * 100;
    staging.run(`stg_${sequence}`, artifact, `row_${sequence}`, market, day, priceType);
    insert.run(`obs_${sequence}`, `stg_${sequence}`, publication, artifact, item, market, priceType, minor, minor, minor, minor, day, day, `cmp_${sequence}`, `lin_${sequence}`, `eff_${sequence}`, `${day}T02:00:00.000Z`);
  };
  add("pub_h", "art_h", "item_big_onion", "market_dambulla", "wholesale_observed", "2026-09-01", 250);
  add("pub_h", "art_h", "item_big_onion", "market_dambulla", "wholesale_observed", "2026-09-03", 275);
  add("pub_h", "art_h", "item_big_onion", "market_pettah", "wholesale_observed", "2026-09-03", 268);
  // Two product labels on the Keells shelf the same day: the store's price is their range.
  add("pub_k", "art_k", "item_big_onion", "market_keells_online", "retail_online_store", "2026-09-04", 370);
  add("pub_k", "art_k", "item_big_onion", "market_keells_online", "retail_online_store", "2026-09-04", 390);
  add("pub_c", "art_c", "item_big_onion", "market_cargills_online", "retail_online_store", "2026-09-04", 400);
  add("pub_h", "art_h", "item_big_onion_imported", "market_dambulla", "wholesale_observed", "2026-09-03", 255);
}

export async function warehouseFor(database: ReturnType<typeof openOperationalDatabase>) {
  const client = await embeddedWarehouse();
  await syncWarehouse(database, client);
  return client;
}
