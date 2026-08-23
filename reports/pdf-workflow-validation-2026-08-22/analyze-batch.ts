import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openOperationalDatabase } from "../../foundry/src/db.ts";

type BatchResult = {
  publication_id: string;
  published_date: string;
  title: string;
  run_id: string | null;
  status: string;
  artifact_id: string | null;
  observation_count: number;
  parser_strategy: string | null;
  parser_confidence: number | null;
  page_count: number | null;
  error_code: string | null;
  fetched_sha256: string | null;
  archive_sha256: string | null;
  archive_checksum_changed: boolean;
  duration_ms: number;
};

type Observation = {
  artifact_id: string;
  publication_id: string;
  publication_date: string;
  source_date: string;
  item: string;
  market: string;
  unit: string;
  min_lkr: number;
  max_lkr: number;
  midpoint_lkr: number;
  status: string;
};

const reportRoot = resolve(process.cwd(), "reports/pdf-workflow-validation-2026-08-22");
const databasePath = resolve(process.cwd(), "data/runtime/local-validation.sqlite");
const resultsPath = resolve(reportRoot, "batch-results.json");
const outputPath = resolve(reportRoot, "analysis-output.json");
const database = openOperationalDatabase(databasePath);

try {
  const batch = JSON.parse(await readFile(resultsPath, "utf8")) as { batch_id: string; updated_at: string; documents: BatchResult[] };
  database.exec("CREATE TEMP TABLE validation_batch_artifact (artifact_id TEXT PRIMARY KEY)");
  const insert = database.prepare("INSERT INTO validation_batch_artifact (artifact_id) VALUES (?)");
  for (const document of batch.documents) if (document.artifact_id) insert.run(document.artifact_id);

  const observations = database
    .prepare(
      `SELECT observation.artifact_id, publication.id AS publication_id,
       substr(publication.published_at, 1, 10) AS publication_date,
       observation.source_date, observation.source_item_label AS item,
       observation.source_market_label AS market, observation.source_unit AS unit,
       observation.min_value_minor / 100.0 AS min_lkr,
       observation.max_value_minor / 100.0 AS max_lkr,
       (observation.min_value_minor + observation.max_value_minor) / 200.0 AS midpoint_lkr,
       observation.status
       FROM staging_observation observation
       JOIN validation_batch_artifact batch_artifact USING (artifact_id)
       JOIN source_artifact artifact ON artifact.id = observation.artifact_id
       JOIN source_publication publication ON publication.id = artifact.publication_id
       ORDER BY observation.source_date, item, market, publication_date`,
    )
    .all() as Observation[];

  const exactKeys = new Map<string, number>();
  const analyticalGroups = new Map<string, Observation[]>();
  for (const observation of observations) {
    const exactKey = [observation.artifact_id, observation.source_date, observation.item, observation.market, observation.min_lkr, observation.max_lkr].join("|");
    exactKeys.set(exactKey, (exactKeys.get(exactKey) ?? 0) + 1);
    const analyticalKey = [observation.source_date, observation.item, observation.market, observation.unit].join("|");
    const group = analyticalGroups.get(analyticalKey) ?? [];
    group.push(observation);
    analyticalGroups.set(analyticalKey, group);
  }

  const deduplicated = [...analyticalGroups.values()].map((group) => [...group].sort(preferredObservation)[0]!);
  const duplicateGroups = [...analyticalGroups.values()].filter((group) => group.length > 1);
  const conflictingGroups = duplicateGroups.filter((group) => new Set(group.map((row) => `${row.min_lkr}|${row.max_lkr}`)).size > 1);
  const dates = [...new Set(deduplicated.map((row) => row.source_date))].sort();
  const items = [...new Set(deduplicated.map((row) => row.item))].sort();
  const markets = [...new Set(deduplicated.map((row) => row.market))].sort();
  const invalid = observations.filter((row) => row.min_lkr <= 0 || row.max_lkr <= 0 || row.min_lkr > row.max_lkr || !/^\d{4}-\d{2}-\d{2}$/u.test(row.source_date));
  const exactDuplicateRows = [...exactKeys.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const priorDayRows = observations.filter((row) => row.source_date !== row.publication_date).length;

  const monthlyQuality = groupBy(batch.documents, (document) => document.published_date.slice(0, 7)).map(([month, documents]) => ({
    month,
    documents: documents.length,
    succeeded: documents.filter((document) => document.status === "succeeded").length,
    success_rate: documents.filter((document) => document.status === "succeeded").length / documents.length,
    observations: sum(documents.map((document) => document.observation_count)),
    median_observations_per_pdf: median(documents.map((document) => document.observation_count)),
    min_observations_per_pdf: Math.min(...documents.map((document) => document.observation_count)),
    max_observations_per_pdf: Math.max(...documents.map((document) => document.observation_count)),
    median_duration_seconds: median(documents.map((document) => document.duration_ms)) / 1000,
    median_pages: median(documents.flatMap((document) => document.page_count === null ? [] : [document.page_count])),
  })).sort((left, right) => left.month.localeCompare(right.month));

  const strategyRows = groupBy(batch.documents, (document) => document.parser_strategy ?? "none").map(([strategy, documents]) => ({
    strategy,
    documents: documents.length,
    share: documents.length / batch.documents.length,
    min_confidence: Math.min(...documents.flatMap((document) => document.parser_confidence === null ? [] : [document.parser_confidence])),
    median_confidence: median(documents.flatMap((document) => document.parser_confidence === null ? [] : [document.parser_confidence])),
  }));

  const marketCoverage = markets.map((market) => {
    const rows = deduplicated.filter((row) => row.market === market);
    const coveredDates = new Set(rows.map((row) => row.source_date));
    return {
      market,
      days: coveredDates.size,
      date_coverage_rate: coveredDates.size / dates.length,
      observations: rows.length,
      items: new Set(rows.map((row) => row.item)).size,
      median_midpoint_lkr: round(median(rows.map((row) => row.midpoint_lkr)), 1),
    };
  }).sort((left, right) => right.days - left.days || right.observations - left.observations);

  const focusMarket = "Peliyagoda";
  const focusItems = ["Tomato", "Beans", "Carrot", "Green Chillies"];
  const priceTrend = deduplicated
    .filter((row) => row.market === focusMarket && focusItems.includes(row.item))
    .map((row) => ({
      date: row.source_date,
      item: row.item,
      market: row.market,
      midpoint_lkr: round(row.midpoint_lkr, 1),
      min_lkr: row.min_lkr,
      max_lkr: row.max_lkr,
      unit: row.unit,
      publication_date: row.publication_date,
    }))
    .sort((left, right) => left.date.localeCompare(right.date) || left.item.localeCompare(right.item));

  const peliyagoda = deduplicated.filter((row) => row.market === focusMarket && row.unit === "kg");
  const itemSeries = groupBy(peliyagoda, (row) => row.item);
  const periodChanges = itemSeries.flatMap(([item, rows]) => {
    const ordered = [...rows].sort((left, right) => left.source_date.localeCompare(right.source_date));
    const uniqueDays = new Set(ordered.map((row) => row.source_date)).size;
    if (uniqueDays < 60) return [];
    const first = ordered.slice(0, 14);
    const last = ordered.slice(-14);
    const firstMedian = median(first.map((row) => row.midpoint_lkr));
    const lastMedian = median(last.map((row) => row.midpoint_lkr));
    return [{
      item,
      market: focusMarket,
      days: uniqueDays,
      first_period_median_lkr: round(firstMedian, 1),
      last_period_median_lkr: round(lastMedian, 1),
      change_rate: round((lastMedian - firstMedian) / firstMedian, 4),
      absolute_change_lkr: round(lastMedian - firstMedian, 1),
      first_period: `${first[0]!.source_date} to ${first.at(-1)!.source_date}`,
      last_period: `${last[0]!.source_date} to ${last.at(-1)!.source_date}`,
    }];
  });
  const largestMovements = [...periodChanges]
    .sort((left, right) => Math.abs(right.change_rate) - Math.abs(left.change_rate))
    .slice(0, 14)
    .sort((left, right) => left.change_rate - right.change_rate);
  const orderedChanges = [...periodChanges].sort((left, right) => left.change_rate - right.change_rate);
  const directionalExtremes = [...orderedChanges.slice(0, 7), ...orderedChanges.slice(-7)];

  const volatility = itemSeries.flatMap(([item, rows]) => {
    const values = rows.map((row) => row.midpoint_lkr).sort((left, right) => left - right);
    const uniqueDays = new Set(rows.map((row) => row.source_date)).size;
    if (uniqueDays < 60) return [];
    const middle = median(values);
    return [{
      item,
      market: focusMarket,
      days: uniqueDays,
      observations: rows.length,
      median_midpoint_lkr: round(middle, 1),
      p25_lkr: round(quantile(values, 0.25), 1),
      p75_lkr: round(quantile(values, 0.75), 1),
      relative_iqr: round((quantile(values, 0.75) - quantile(values, 0.25)) / middle, 4),
      min_midpoint_lkr: Math.min(...values),
      max_midpoint_lkr: Math.max(...values),
    }];
  }).sort((left, right) => right.relative_iqr - left.relative_iqr);

  const documentExtremes = [...batch.documents]
    .sort((left, right) => left.observation_count - right.observation_count)
    .map((document) => ({
      published_date: document.published_date,
      title: document.title,
      observations: document.observation_count,
      pages: document.page_count,
      parser_strategy: document.parser_strategy,
      parser_confidence: document.parser_confidence,
      duration_seconds: round(document.duration_ms / 1000, 2),
    }));

  const output = {
    generated_at: new Date().toISOString(),
    batch_id: batch.batch_id,
    definitions: {
      document_cohort: "120 randomly selected archived HARTI publications dated 2026-04-01 through 2026-08-22, excluding previously successful PDF-processing runs",
      observation_grain: "one source date × source item label × wholesale market × source unit after preferring the publication closest to the source date",
      price_measure: "midpoint of the published minimum and maximum wholesale range, in LKR per source unit",
      period_change: "median of first 14 available Peliyagoda observations versus median of last 14 available observations",
      volatility: "interquartile range divided by median midpoint price for Peliyagoda items with at least 60 observed dates",
    },
    summary: {
      selected_documents: batch.documents.length,
      succeeded_documents: batch.documents.filter((document) => document.status === "succeeded").length,
      failed_documents: batch.documents.filter((document) => document.status !== "succeeded").length,
      success_rate: batch.documents.filter((document) => document.status === "succeeded").length / batch.documents.length,
      stored_observations: observations.length,
      deduplicated_observations: deduplicated.length,
      exact_duplicate_rows: exactDuplicateRows,
      duplicate_analytical_grain_groups: duplicateGroups.length,
      conflicting_duplicate_groups: conflictingGroups.length,
      invalid_observations: invalid.length,
      prior_day_rows: priorDayRows,
      unique_source_dates: dates.length,
      first_source_date: dates[0],
      last_source_date: dates.at(-1),
      unique_item_labels: items.length,
      unique_markets: markets.length,
      checksum_changes: batch.documents.filter((document) => document.archive_checksum_changed).length,
      median_observations_per_pdf: median(batch.documents.map((document) => document.observation_count)),
      min_observations_per_pdf: Math.min(...batch.documents.map((document) => document.observation_count)),
      max_observations_per_pdf: Math.max(...batch.documents.map((document) => document.observation_count)),
      median_workflow_duration_seconds: round(median(batch.documents.map((document) => document.duration_ms)) / 1000, 2),
      median_parser_confidence: median(batch.documents.flatMap((document) => document.parser_confidence === null ? [] : [document.parser_confidence])),
      staging_statuses: Object.fromEntries(groupBy(observations, (row) => row.status).map(([status, rows]) => [status, rows.length])),
    },
    monthly_quality: monthlyQuality,
    parser_strategies: strategyRows,
    market_coverage: marketCoverage,
    price_trend: priceTrend,
    period_changes: periodChanges.sort((left, right) => left.change_rate - right.change_rate),
    largest_movements: largestMovements,
    directional_extremes: directionalExtremes,
    volatility,
    document_extremes: [...documentExtremes.slice(0, 8), ...documentExtremes.slice(-8)],
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output.summary, null, 2));
} finally {
  database.close();
}

function preferredObservation(left: Observation, right: Observation): number {
  const leftDistance = Math.abs(dateNumber(left.publication_date) - dateNumber(left.source_date));
  const rightDistance = Math.abs(dateNumber(right.publication_date) - dateNumber(right.source_date));
  return leftDistance - rightDistance || right.publication_date.localeCompare(left.publication_date);
}

function dateNumber(value: string): number {
  return new Date(`${value}T00:00:00.000Z`).valueOf();
}

function groupBy<T>(values: T[], key: (value: T) => string): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const name = key(value);
    const group = groups.get(name) ?? [];
    group.push(value);
    groups.set(name, group);
  }
  return [...groups.entries()];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  return quantile(ordered, 0.5);
}

function quantile(ordered: number[], probability: number): number {
  if (!ordered.length) return 0;
  const position = (ordered.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  const lowerValue = ordered[lower]!;
  const upperValue = ordered[Math.min(lower + 1, ordered.length - 1)]!;
  return lowerValue + (upperValue - lowerValue) * fraction;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
