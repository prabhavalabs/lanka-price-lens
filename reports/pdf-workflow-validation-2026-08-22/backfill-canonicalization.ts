import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { finishStage, logStage, openOperationalDatabase, startStage } from "../../foundry/src/db.ts";
import { readMappingBundle } from "../../foundry/src/manifest.ts";
import { canonicalizeArtifact } from "../../foundry/src/mapping.ts";
import { assessArtifactCompleteness } from "../../foundry/src/quality.ts";

type BatchDocument = {
  run_id: string | null;
  artifact_id: string | null;
  published_date: string;
  title: string;
  status: string;
};

const root = process.cwd();
const reportRoot = resolve(root, "reports/pdf-workflow-validation-2026-08-22");
const database = openOperationalDatabase(resolve(root, "data/runtime/local-validation.sqlite"));
const bundle = await readMappingBundle(resolve(root, "data/mappings/harti_daily_food_prices.json"));
const batch = JSON.parse(await readFile(resolve(reportRoot, "batch-results.json"), "utf8")) as { documents: BatchDocument[] };
const results: Array<Record<string, unknown>> = [];

try {
  const documents = batch.documents
    .filter((document): document is BatchDocument & { run_id: string; artifact_id: string } =>
      document.status === "succeeded" && Boolean(document.run_id) && Boolean(document.artifact_id),
    )
    .sort((left, right) => left.published_date.localeCompare(right.published_date));

  for (const [index, document] of documents.entries()) {
    startStage(database, document.run_id, "assess_completeness", 1, {
      artifact_id: document.artifact_id,
      mapping_version: bundle.mapping_version,
    });
    const quality = assessArtifactCompleteness(database, document.run_id, document.artifact_id, bundle);
    finishStage(database, document.run_id, "assess_completeness", "succeeded", {
      outputCount: quality.observedCells,
      warningCount: quality.status === "complete" ? 0 : 1,
      output: {
        status: quality.status,
        score: quality.score,
        item_coverage: quality.itemCoverage,
        market_coverage: quality.marketCoverage,
        cell_coverage: quality.cellCoverage,
        mapping_coverage: quality.mappingCoverage,
        expected_cells: quality.expectedCells,
        observed_cells: quality.observedCells,
        unknown_items: quality.unknownItems,
      },
    });
    logStage(database, document.run_id, "assess_completeness", "info", "Document completeness assessed", {
      artifact_id: document.artifact_id,
      status: quality.status,
      score: quality.score,
    });

    const parser = database
      .prepare("SELECT parser_strategy FROM source_artifact WHERE id = ?")
      .get(document.artifact_id) as { parser_strategy: string | null };
    startStage(database, document.run_id, "canonicalize_data", quality.totalRows, {
      artifact_id: document.artifact_id,
      mapping_version: bundle.mapping_version,
      completeness_status: quality.status,
    });
    const canonical = canonicalizeArtifact(
      database,
      document.run_id,
      document.artifact_id,
      bundle,
      `harti-adaptive@2:${parser.parser_strategy ?? "unknown"}`,
    );
    const outputCount = canonical.accepted + canonical.corrected + canonical.historical;
    finishStage(database, document.run_id, "canonicalize_data", "succeeded", {
      outputCount,
      warningCount: canonical.quarantined,
      output: canonical,
    });
    logStage(database, document.run_id, "canonicalize_data", "info", "Canonical observations promoted", {
      artifact_id: document.artifact_id,
      ...canonical,
    });
    database.prepare("UPDATE source_artifact SET status = 'canonicalized' WHERE id = ?").run(document.artifact_id);
    database
      .prepare("UPDATE source_publication SET status = 'canonicalized' WHERE id = (SELECT publication_id FROM source_artifact WHERE id = ?)")
      .run(document.artifact_id);
    results.push({
      published_date: document.published_date,
      title: document.title,
      run_id: document.run_id,
      artifact_id: document.artifact_id,
      quality_status: quality.status,
      completeness_score: quality.score,
      ...canonical,
    });
    console.log(JSON.stringify({ progress: `${index + 1}/${documents.length}`, date: document.published_date, quality: quality.status, score: quality.score, ...canonical }));
  }

  const summary = database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM product) AS products,
        (SELECT COUNT(*) FROM item) AS price_series,
        (SELECT COUNT(*) FROM market) AS markets,
        (SELECT COUNT(*) FROM price_observation) AS observation_versions,
        (SELECT COUNT(*) FROM price_observation WHERE status = 'active') AS active_observations,
        (SELECT COUNT(*) FROM price_observation WHERE status = 'superseded') AS superseded_observations,
        (SELECT COUNT(*) FROM quarantine WHERE status = 'open') AS open_quarantines`,
    )
    .get();
  console.log(JSON.stringify({ completed: results.length, summary }));
} finally {
  database.close();
}
