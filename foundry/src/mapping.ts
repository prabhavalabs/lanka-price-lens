import { createHash } from "node:crypto";

import type { MappingBundle } from "@lanka-pricelens/shared";

import { finishStage, newId, startStage, type OperationalDatabase } from "./db.ts";

type StagingRow = {
  id: string;
  run_id: string;
  artifact_id: string;
  publication_id: string;
  source_id: string;
  source_row_ref: string;
  source_item_label: string;
  source_market_label: string;
  source_date: string;
  price_type: string;
  currency: string;
  source_quantity: string;
  source_unit: string;
  min_value_minor: number;
  max_value_minor: number;
  published_at: string | null;
};

type ActiveObservation = {
  id: string;
  item_id: string;
  market_id: string;
  min_value_minor: number;
  max_value_minor: number;
  normalized_min_value_minor: number;
  normalized_max_value_minor: number;
  conversion_rule_id: string;
};

export function canonicalizeRun(
  database: OperationalDatabase,
  runId: string,
  bundle: MappingBundle,
  parserVersion: string,
): { accepted: number; corrected: number; duplicates: number; quarantined: number } {
  const run = database.prepare("SELECT source_id, status FROM ingest_run WHERE id = ?").get(runId) as
    | { source_id: string; status: string }
    | undefined;
  if (!run) throw new Error("RUN_NOT_FOUND");
  if (run.status !== "succeeded") throw new Error("RUN_NOT_SUCCESSFUL");
  if (run.source_id !== bundle.source_id) throw new Error("MAPPING_SOURCE_MISMATCH");

  startStage(database, runId, "map");
  startStage(database, runId, "canonicalize");
  const result = { accepted: 0, corrected: 0, duplicates: 0, quarantined: 0 };
  try {
    syncMappingBundle(database, bundle);
    const rows = database
      .prepare(
        `SELECT so.*, sa.publication_id, sp.source_id, sp.published_at
         FROM staging_observation so
         JOIN source_artifact sa ON sa.id = so.artifact_id
         JOIN source_publication sp ON sp.id = sa.publication_id
         WHERE so.run_id = ? ORDER BY so.artifact_id, so.source_row_ref, so.source_market_label`,
      )
      .all(runId) as StagingRow[];

    database.transaction(() => {
      for (const row of rows) canonicalizeRow(database, row, bundle, parserVersion, result);
    })();
    finishStage(database, runId, "map", "succeeded", { outputCount: result.accepted + result.corrected, warningCount: result.quarantined });
    finishStage(database, runId, "canonicalize", "succeeded", { outputCount: result.accepted + result.corrected, warningCount: result.quarantined });
    database
      .prepare("UPDATE ingest_run SET quarantined_count = quarantined_count + ? WHERE id = ?")
      .run(result.quarantined, runId);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishStage(database, runId, "map", "failed", { errorCode: "CANONICALIZATION_FAILED", errorMessage: message });
    finishStage(database, runId, "canonicalize", "failed", { errorCode: "CANONICALIZATION_FAILED", errorMessage: message });
    throw error;
  }
}

export function syncMappingBundle(database: OperationalDatabase, bundle: MappingBundle): void {
  database.transaction(() => {
    database.prepare("DELETE FROM source_item_mapping WHERE source_id = ?").run(bundle.source_id);
    database.prepare("DELETE FROM source_market_mapping WHERE source_id = ?").run(bundle.source_id);
    for (const item of bundle.items) {
      database
        .prepare(
          `INSERT INTO item (id, entity_type, canonical_label_en, canonical_label_si, canonical_label_ta, variety, grade)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET entity_type = excluded.entity_type,
             canonical_label_en = excluded.canonical_label_en, canonical_label_si = excluded.canonical_label_si,
             canonical_label_ta = excluded.canonical_label_ta, variety = excluded.variety, grade = excluded.grade`,
        )
        .run(item.id, item.entity_type, item.canonical_label_en, item.canonical_label_si, item.canonical_label_ta, item.variety, item.grade);
      for (const label of item.source_labels) {
        database
          .prepare(
            `INSERT INTO source_item_mapping
             (source_id, source_label, item_id, mapping_version, reviewed_by, reviewed_at, evidence_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_id, source_label) DO UPDATE SET item_id = excluded.item_id,
               mapping_version = excluded.mapping_version, reviewed_by = excluded.reviewed_by,
               reviewed_at = excluded.reviewed_at, evidence_ref = excluded.evidence_ref`,
          )
          .run(bundle.source_id, label, item.id, bundle.mapping_version, bundle.reviewed_by, bundle.reviewed_at, bundle.evidence_ref);
      }
    }
    for (const market of bundle.markets) {
      database
        .prepare(
          `INSERT INTO market (id, type, label_en, label_si, label_ta, pcode, scope_note)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET type = excluded.type, label_en = excluded.label_en,
             label_si = excluded.label_si, label_ta = excluded.label_ta,
             pcode = excluded.pcode, scope_note = excluded.scope_note`,
        )
        .run(market.id, market.type, market.label_en, market.label_si, market.label_ta, market.pcode, market.scope_note);
      for (const label of market.source_labels) {
        database
          .prepare(
            `INSERT INTO source_market_mapping
             (source_id, source_label, market_id, mapping_version, reviewed_by, reviewed_at, evidence_ref)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source_id, source_label) DO UPDATE SET market_id = excluded.market_id,
               mapping_version = excluded.mapping_version, reviewed_by = excluded.reviewed_by,
               reviewed_at = excluded.reviewed_at, evidence_ref = excluded.evidence_ref`,
          )
          .run(bundle.source_id, label, market.id, bundle.mapping_version, bundle.reviewed_by, bundle.reviewed_at, bundle.evidence_ref);
      }
    }
    for (const unit of bundle.units) {
      const existing = database.prepare("SELECT * FROM unit_conversion_rule WHERE id = ?").get(unit.id) as
        | {
            source_unit: string;
            normalized_unit: string;
            factor_numerator: number;
            factor_denominator: number;
            rounding_mode: string;
          }
        | undefined;
      if (
        existing &&
        (existing.source_unit !== unit.source_unit ||
          existing.normalized_unit !== unit.normalized_unit ||
          existing.factor_numerator !== unit.factor_numerator ||
          existing.factor_denominator !== unit.factor_denominator ||
          existing.rounding_mode !== unit.rounding_mode)
      ) {
        throw new Error(`UNIT_RULE_ID_REUSED:${unit.id}`);
      }
      if (!existing) {
        database
          .prepare(
            `INSERT INTO unit_conversion_rule
             (id, source_unit, normalized_unit, factor_numerator, factor_denominator, rounding_mode, mapping_version)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            unit.id,
            unit.source_unit,
            unit.normalized_unit,
            unit.factor_numerator,
            unit.factor_denominator,
            unit.rounding_mode,
            bundle.mapping_version,
          );
      }
    }
    database
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'mapping.bundle.synced', 'source', ?, ?, ?)`,
      )
      .run(
        newId("audit"),
        bundle.reviewed_by,
        bundle.source_id,
        JSON.stringify({ mapping_version: bundle.mapping_version, evidence_ref: bundle.evidence_ref }),
        new Date().toISOString(),
      );
  })();
}

function canonicalizeRow(
  database: OperationalDatabase,
  row: StagingRow,
  bundle: MappingBundle,
  parserVersion: string,
  result: { accepted: number; corrected: number; duplicates: number; quarantined: number },
): void {
  const item = database
    .prepare("SELECT item_id FROM source_item_mapping WHERE source_id = ? AND source_label = ?")
    .get(row.source_id, row.source_item_label) as { item_id: string } | undefined;
  if (!item) return quarantine(database, row, "UNKNOWN_ITEM", result);
  const market = database
    .prepare("SELECT market_id FROM source_market_mapping WHERE source_id = ? AND source_label = ?")
    .get(row.source_id, row.source_market_label) as { market_id: string } | undefined;
  if (!market) return quarantine(database, row, "UNKNOWN_MARKET", result);
  const unit = bundle.units.find((candidate) => candidate.source_unit === row.source_unit);
  const rule = unit
    ? (database
    .prepare(
      `SELECT id, normalized_unit, factor_numerator, factor_denominator
       FROM unit_conversion_rule WHERE id = ?`,
    )
    .get(unit.id) as { id: string; normalized_unit: string; factor_numerator: number; factor_denominator: number } | undefined)
    : undefined;
  if (!rule) return quarantine(database, row, "UNKNOWN_UNIT", result);
  if (
    !Number.isSafeInteger(row.min_value_minor) ||
    !Number.isSafeInteger(row.max_value_minor) ||
    row.min_value_minor <= 0 ||
    row.max_value_minor <= 0 ||
    row.min_value_minor > row.max_value_minor
  ) {
    return quarantine(database, row, "INVALID_PRICE_RANGE", result);
  }
  if (!/^[A-Z]{3}$/u.test(row.currency) || !knownPriceTypes.has(row.price_type)) {
    return quarantine(database, row, "MISSING_REQUIRED_FIELD", result);
  }
  if (!validDate(row.source_date) || (row.published_at && row.source_date > row.published_at.slice(0, 10))) {
    return quarantine(database, row, "INVALID_DATE", result);
  }

  const quantity = decimalRatio(row.source_quantity);
  if (!quantity) return quarantine(database, row, "MISSING_REQUIRED_FIELD", result);
  const denominator = rule.factor_numerator * quantity.numerator;
  const numerator = rule.factor_denominator * quantity.denominator;
  const normalizedMinimum = Math.round((row.min_value_minor * numerator) / denominator);
  const normalizedMaximum = Math.round((row.max_value_minor * numerator) / denominator);
  if (
    !Number.isSafeInteger(normalizedMinimum) ||
    !Number.isSafeInteger(normalizedMaximum) ||
    normalizedMinimum <= 0 ||
    normalizedMaximum <= 0
  ) {
    return quarantine(database, row, "INVALID_PRICE_RANGE", result);
  }
  const lineageKey = digest([row.artifact_id, row.source_row_ref, row.source_market_label]);
  const comparabilityKey = digest([
    item.item_id,
    market.market_id,
    row.price_type,
    row.currency,
    rule.normalized_unit,
    row.source_id,
  ]);
  const active = database
    .prepare(
      `SELECT id, item_id, market_id, min_value_minor, max_value_minor,
       normalized_min_value_minor, normalized_max_value_minor, conversion_rule_id
       FROM price_observation WHERE lineage_key = ? AND status = 'active'`,
    )
    .get(lineageKey) as ActiveObservation | undefined;
  resolveMappingQuarantine(database, row, bundle);
  if (active && sameObservation(active, item.item_id, market.market_id, row, normalizedMinimum, normalizedMaximum, rule.id)) {
    database.prepare("UPDATE staging_observation SET status = 'canonicalized' WHERE id = ?").run(row.id);
    result.duplicates += 1;
    return;
  }

  if (!active) {
    const duplicate = database
      .prepare(
        `SELECT id, min_value_minor, max_value_minor FROM price_observation
         WHERE source_publication_id = ? AND comparability_key = ? AND observed_from = ? AND status = 'active'
         LIMIT 1`,
      )
      .get(row.publication_id, comparabilityKey, row.source_date) as
      | { id: string; min_value_minor: number; max_value_minor: number }
      | undefined;
    if (duplicate) {
      if (duplicate.min_value_minor === row.min_value_minor && duplicate.max_value_minor === row.max_value_minor) {
        database.prepare("UPDATE staging_observation SET status = 'duplicate' WHERE id = ?").run(row.id);
        result.duplicates += 1;
        return;
      }
      return quarantine(database, row, "SOURCE_CORRECTION_PENDING", result);
    }
  }

  const id = newId("observation");
  if (active) database.prepare("UPDATE price_observation SET status = 'superseded' WHERE id = ?").run(active.id);
  database
    .prepare(
      `INSERT INTO price_observation (
        id, run_id, staging_id, source_publication_id, source_artifact_id, item_id, market_id,
        price_type, currency, value_kind, min_value_minor, max_value_minor,
        normalized_min_value_minor, normalized_max_value_minor, source_quantity, source_unit,
        normalized_quantity, normalized_unit, conversion_rule_id, observed_from, observed_to, source_row_ref,
        confidence, comparability_key, lineage_key, parser_version, mapping_version,
        status, supersedes_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'range', ?, ?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?,
        'official_verified', ?, ?, ?, ?, 'active', ?, ?)`,
    )
    .run(
      id,
      row.run_id,
      row.id,
      row.publication_id,
      row.artifact_id,
      item.item_id,
      market.market_id,
      row.price_type,
      row.currency,
      row.min_value_minor,
      row.max_value_minor,
      normalizedMinimum,
      normalizedMaximum,
      row.source_quantity,
      row.source_unit,
      rule.normalized_unit,
      rule.id,
      row.source_date,
      row.source_date,
      row.source_row_ref,
      comparabilityKey,
      lineageKey,
      parserVersion,
      bundle.mapping_version,
      active?.id ?? null,
      new Date().toISOString(),
    );
  database.prepare("UPDATE staging_observation SET status = 'canonicalized' WHERE id = ?").run(row.id);
  if (active) {
    result.corrected += 1;
    database
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'observation.superseded', 'observation', ?, ?, ?)`,
      )
      .run(newId("audit"), bundle.reviewed_by, id, JSON.stringify({ supersedes_id: active.id }), new Date().toISOString());
  } else {
    result.accepted += 1;
  }
}

function quarantine(
  database: OperationalDatabase,
  row: StagingRow,
  reason: string,
  result: { quarantined: number },
): void {
  const exists = database
    .prepare(
      `SELECT 1 FROM quarantine WHERE run_id = ? AND artifact_id = ? AND source_row_ref = ?
       AND reason_code = ? AND status = 'open' AND json_extract(details_json, '$.market') = ?`,
    )
    .get(row.run_id, row.artifact_id, row.source_row_ref, reason, row.source_market_label);
  if (!exists) {
    database
      .prepare(
        `INSERT INTO quarantine (id, run_id, artifact_id, reason_code, source_row_ref, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("quarantine"),
        row.run_id,
        row.artifact_id,
        reason,
        row.source_row_ref,
        JSON.stringify({ item: row.source_item_label, market: row.source_market_label, unit: row.source_unit }),
        new Date().toISOString(),
      );
    result.quarantined += 1;
  }
  database.prepare("UPDATE staging_observation SET status = 'quarantined' WHERE id = ?").run(row.id);
}

function resolveMappingQuarantine(database: OperationalDatabase, row: StagingRow, bundle: MappingBundle): void {
  database
    .prepare(
      `UPDATE quarantine SET status = 'resolved', resolved_at = ?, resolution_note = ?
       WHERE run_id = ? AND artifact_id = ? AND source_row_ref = ? AND status = 'open'
       AND reason_code IN ('UNKNOWN_ITEM', 'UNKNOWN_MARKET', 'UNKNOWN_UNIT')
       AND json_extract(details_json, '$.market') = ?`,
    )
    .run(
      new Date().toISOString(),
      `Resolved by reviewed mapping ${bundle.mapping_version} (${bundle.evidence_ref})`,
      row.run_id,
      row.artifact_id,
      row.source_row_ref,
      row.source_market_label,
    );
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

const knownPriceTypes = new Set([
  "retail_observed",
  "wholesale_observed",
  "producer_observed",
  "regulated_maximum",
  "retailer_listing",
  "reported_transaction",
  "index_value",
]);

function decimalRatio(value: string): { numerator: number; denominator: number } | undefined {
  const match = value.match(/^(\d+)(?:\.(\d+))?$/u);
  if (!match) return undefined;
  const fraction = match[2] ?? "";
  const denominator = 10 ** fraction.length;
  const numerator = Number(`${match[1]}${fraction}`);
  return Number.isSafeInteger(numerator) && numerator > 0 && Number.isSafeInteger(denominator)
    ? { numerator, denominator }
    : undefined;
}

function digest(parts: string[]): string {
  return createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

function sameObservation(
  active: ActiveObservation,
  itemId: string,
  marketId: string,
  row: StagingRow,
  normalizedMinimum: number,
  normalizedMaximum: number,
  ruleId: string,
): boolean {
  return (
    active.item_id === itemId &&
    active.market_id === marketId &&
    active.min_value_minor === row.min_value_minor &&
    active.max_value_minor === row.max_value_minor &&
    active.normalized_min_value_minor === normalizedMinimum &&
    active.normalized_max_value_minor === normalizedMaximum &&
    active.conversion_rule_id === ruleId
  );
}
