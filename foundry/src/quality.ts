import type { MappingBundle } from "@lanka-pricelens/shared";

import { type OperationalDatabase } from "./db.ts";
import { syncMappingBundle } from "./mapping.ts";
import { matchItemPattern } from "./patterns.ts";

type QualityStatus = "complete" | "review_required" | "incomplete" | "not_configured";

export type CompletenessAssessment = {
  status: QualityStatus;
  score: number;
  itemCoverage: number;
  marketCoverage: number;
  cellCoverage: number;
  mappingCoverage: number;
  expectedItems: number;
  observedItems: number;
  expectedMarkets: number;
  observedMarkets: number;
  expectedCells: number;
  observedCells: number;
  totalRows: number;
  mappedRows: number;
  unknownItemRows: number;
  unknownMarketRows: number;
  unknownUnitRows: number;
  missingItems: string[];
  missingMarkets: string[];
  missingCells: Array<{ item: string; market: string }>;
  unknownItems: string[];
  unknownMarkets: string[];
  unknownUnits: string[];
};

type SourceRow = {
  source_item_label: string;
  source_market_label: string;
  source_unit: string;
};

export function assessArtifactCompleteness(
  database: OperationalDatabase,
  runId: string,
  artifactId: string,
  bundle?: MappingBundle,
): CompletenessAssessment {
  const rows = database
    .prepare(
      `SELECT source_item_label, source_market_label, source_unit
       FROM staging_observation WHERE artifact_id = ? AND status != 'stale'`,
    )
    .all(artifactId) as SourceRow[];
  if (!bundle) {
    const assessment: CompletenessAssessment = {
      status: "not_configured",
      score: 0,
      itemCoverage: 0,
      marketCoverage: 0,
      cellCoverage: 0,
      mappingCoverage: 0,
      expectedItems: 0,
      observedItems: 0,
      expectedMarkets: 0,
      observedMarkets: 0,
      expectedCells: 0,
      observedCells: 0,
      totalRows: rows.length,
      mappedRows: 0,
      unknownItemRows: rows.length,
      unknownMarketRows: rows.length,
      unknownUnitRows: rows.length,
      missingItems: [],
      missingMarkets: [],
      missingCells: [],
      unknownItems: unique(rows.map((row) => row.source_item_label)),
      unknownMarkets: unique(rows.map((row) => row.source_market_label)),
      unknownUnits: unique(rows.map((row) => row.source_unit)),
    };
    persistAssessment(database, runId, artifactId, null, assessment);
    return assessment;
  }

  syncMappingBundle(database, bundle);
  const itemLabels = new Set(bundle.items.flatMap((item) => item.source_labels));
  const marketLabels = new Set(bundle.markets.flatMap((market) => market.source_labels));
  const units = new Set(bundle.units.map((unit) => unit.source_unit));
  const expectedCells = new Set(
    bundle.items.flatMap((item) =>
      item.source_labels.flatMap((itemLabel) => item.expected_market_labels.map((marketLabel) => cellKey(itemLabel, marketLabel))),
    ),
  );
  const expectedMarkets = new Set(bundle.items.flatMap((item) => item.expected_market_labels));
  const observedItems = new Set(rows.filter((row) => itemLabels.has(row.source_item_label)).map((row) => row.source_item_label));
  const observedMarkets = new Set(rows.filter((row) => marketLabels.has(row.source_market_label)).map((row) => row.source_market_label));
  const observedCells = new Set(
    rows
      .map((row) => cellKey(row.source_item_label, row.source_market_label))
      .filter((key) => expectedCells.has(key)),
  );
  // A label a pattern rule maps counts as mapped, so whole-catalogue bundles are scored on what they promote, not only on exact labels.
  const itemMapped = (row: SourceRow) => itemLabels.has(row.source_item_label) || matchItemPattern(bundle, row.source_item_label, "1", row.source_unit) !== null;
  const mappedRows = rows.filter((row) => itemMapped(row) && marketLabels.has(row.source_market_label) && units.has(row.source_unit)).length;
  const itemCoverage = ratio(observedItems.size, itemLabels.size);
  const marketCoverage = ratio(observedMarkets.size, expectedMarkets.size);
  const cellCoverage = ratio(observedCells.size, expectedCells.size);
  const mappingCoverage = ratio(mappedRows, rows.length);
  const score = round(itemCoverage * 0.25 + marketCoverage * 0.15 + cellCoverage * 0.45 + mappingCoverage * 0.15);
  const unknownItems = unique(rows.filter((row) => !itemMapped(row)).map((row) => row.source_item_label));
  const unknownMarkets = unique(rows.filter((row) => !marketLabels.has(row.source_market_label)).map((row) => row.source_market_label));
  const unknownUnits = unique(rows.filter((row) => !units.has(row.source_unit)).map((row) => row.source_unit));
  const belowThreshold =
    itemCoverage < bundle.completeness.minimum_item_coverage ||
    marketCoverage < bundle.completeness.minimum_market_coverage ||
    cellCoverage < bundle.completeness.minimum_cell_coverage ||
    mappingCoverage < bundle.completeness.minimum_mapping_coverage ||
    score < bundle.completeness.minimum_score;
  const status: QualityStatus = belowThreshold
    ? "incomplete"
    : unknownItems.length || unknownMarkets.length || unknownUnits.length
      ? "review_required"
      : "complete";
  const assessment: CompletenessAssessment = {
    status,
    score,
    itemCoverage: round(itemCoverage),
    marketCoverage: round(marketCoverage),
    cellCoverage: round(cellCoverage),
    mappingCoverage: round(mappingCoverage),
    expectedItems: itemLabels.size,
    observedItems: observedItems.size,
    expectedMarkets: expectedMarkets.size,
    observedMarkets: observedMarkets.size,
    expectedCells: expectedCells.size,
    observedCells: observedCells.size,
    totalRows: rows.length,
    mappedRows,
    unknownItemRows: rows.filter((row) => !itemMapped(row)).length,
    unknownMarketRows: rows.filter((row) => !marketLabels.has(row.source_market_label)).length,
    unknownUnitRows: rows.filter((row) => !units.has(row.source_unit)).length,
    missingItems: [...itemLabels].filter((label) => !observedItems.has(label)).sort(),
    missingMarkets: [...expectedMarkets].filter((label) => !observedMarkets.has(label)).sort(),
    missingCells: [...expectedCells]
      .filter((key) => !observedCells.has(key))
      .slice(0, 500)
      .map((key) => {
        const [item, market] = key.split("\u001f");
        return { item: item!, market: market! };
      }),
    unknownItems,
    unknownMarkets,
    unknownUnits,
  };
  persistAssessment(database, runId, artifactId, bundle.mapping_version, assessment);
  return assessment;
}

function persistAssessment(
  database: OperationalDatabase,
  runId: string,
  artifactId: string,
  mappingVersion: string | null,
  assessment: CompletenessAssessment,
): void {
  database
    .prepare(
      `INSERT INTO artifact_quality_assessment (
        artifact_id, run_id, mapping_version, status, score, item_coverage, market_coverage,
        cell_coverage, mapping_coverage, expected_items, observed_items, expected_markets,
        observed_markets, expected_cells, observed_cells, total_rows, mapped_rows,
        unknown_item_rows, unknown_market_rows, unknown_unit_rows, diagnostics_json, assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(artifact_id) DO UPDATE SET
        run_id = excluded.run_id, mapping_version = excluded.mapping_version, status = excluded.status,
        score = excluded.score, item_coverage = excluded.item_coverage,
        market_coverage = excluded.market_coverage, cell_coverage = excluded.cell_coverage,
        mapping_coverage = excluded.mapping_coverage, expected_items = excluded.expected_items,
        observed_items = excluded.observed_items, expected_markets = excluded.expected_markets,
        observed_markets = excluded.observed_markets, expected_cells = excluded.expected_cells,
        observed_cells = excluded.observed_cells, total_rows = excluded.total_rows,
        mapped_rows = excluded.mapped_rows, unknown_item_rows = excluded.unknown_item_rows,
        unknown_market_rows = excluded.unknown_market_rows, unknown_unit_rows = excluded.unknown_unit_rows,
        diagnostics_json = excluded.diagnostics_json, assessed_at = excluded.assessed_at`,
    )
    .run(
      artifactId,
      runId,
      mappingVersion,
      assessment.status,
      assessment.score,
      assessment.itemCoverage,
      assessment.marketCoverage,
      assessment.cellCoverage,
      assessment.mappingCoverage,
      assessment.expectedItems,
      assessment.observedItems,
      assessment.expectedMarkets,
      assessment.observedMarkets,
      assessment.expectedCells,
      assessment.observedCells,
      assessment.totalRows,
      assessment.mappedRows,
      assessment.unknownItemRows,
      assessment.unknownMarketRows,
      assessment.unknownUnitRows,
      JSON.stringify({
        missing_items: assessment.missingItems,
        missing_markets: assessment.missingMarkets,
        missing_cells: assessment.missingCells,
        unknown_items: assessment.unknownItems,
        unknown_markets: assessment.unknownMarkets,
        unknown_units: assessment.unknownUnits,
      }),
      new Date().toISOString(),
    );
}

function cellKey(item: string, market: string): string {
  return `${item}\u001f${market}`;
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}
