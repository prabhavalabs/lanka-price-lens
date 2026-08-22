import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { filesystemArchiveStorage } from "../../foundry/src/archive-storage.ts";
import { openOperationalDatabase } from "../../foundry/src/db.ts";
import { readSourceManifest } from "../../foundry/src/manifest.ts";
import { runPdfProcessing } from "../../foundry/src/pipeline.ts";

type SampleDocument = {
  publication_id: string;
  title: string;
  published_date: string;
  archive_id: string;
  r2_key: string;
  source_url: string;
  archive_sha256: string | null;
};

type DocumentResult = SampleDocument & {
  run_id: string | null;
  status: "succeeded" | "failed" | "skipped" | "fetch_failed";
  artifact_id: string | null;
  observation_count: number;
  parser_strategy: string | null;
  parser_confidence: number | null;
  page_count: number | null;
  error_code: string | null;
  error_message: string | null;
  fetched_sha256: string | null;
  archive_checksum_changed: boolean;
  duration_ms: number;
};

const reportRoot = resolve(process.cwd(), "reports/pdf-workflow-validation-2026-08-22");
const databasePath = resolve(process.cwd(), "data/runtime/local-validation.sqlite");
const archiveRoot = resolve(process.cwd(), "data/raw/archive");
const manifestPath = resolve(process.cwd(), "data/manifests/harti_daily_food_prices.json");
const samplePath = resolve(reportRoot, "sample-manifest.json");
const sampleCsvPath = resolve(reportRoot, "sample-manifest.csv");
const resultsPath = resolve(reportRoot, "batch-results.json");
const batchId = "pdf-workflow-validation-2026-08-22";
const windowStart = "2026-04-01";
const windowEnd = "2026-08-22";
const sampleSize = 120;

await mkdir(reportRoot, { recursive: true });
const database = openOperationalDatabase(databasePath);
const manifest = await readSourceManifest(manifestPath);
const archive = filesystemArchiveStorage(archiveRoot);

try {
  const documents = await loadOrCreateSample();
  const existing = await loadExistingResults();
  const completed = new Map(existing.documents.map((document) => [document.publication_id, document]));

  for (const [index, document] of documents.entries()) {
    if (completed.has(document.publication_id)) continue;
    const started = Date.now();
    let fetchedSha256: string | null = null;
    try {
      const response = await fetch(document.source_url, { redirect: "follow" });
      if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") {
        throw new Error("SOURCE_NOT_PDF");
      }
      fetchedSha256 = createHash("sha256").update(bytes).digest("hex");
      await archive.upload(document.r2_key, document.title, bytes, {
        "source-url": document.source_url,
        "source-date": document.published_date,
        sha256: fetchedSha256,
        "validation-batch": batchId,
      });
      const now = new Date().toISOString();
      database
        .prepare(
          `UPDATE archived_pdf SET r2_bucket = ?, r2_uri = ?, byte_size = ?, sha256 = ?, etag = ?,
           uploaded_at = ?, status = 'stored', updated_at = ? WHERE id = ?`,
        )
        .run(archive.bucket, archive.uri!(document.r2_key), bytes.byteLength, fetchedSha256, fetchedSha256, now, now, document.archive_id);

      const workflow = await runPdfProcessing(database, manifest, document.archive_id, {
        trigger: "backfill",
        archive,
      });
      const record = database
        .prepare(
          `SELECT run.id AS run_id, run.status, run.artifact_id, run.error_code, run.error_message,
           artifact.parser_strategy, artifact.parser_confidence,
           json_extract(artifact.inspection_json, '$.pageCount') AS page_count,
           COALESCE((SELECT COUNT(*) FROM staging_observation observation WHERE observation.artifact_id = run.artifact_id), 0) AS observation_count
           FROM ingest_run run LEFT JOIN source_artifact artifact ON artifact.id = run.artifact_id
           WHERE run.id = ?`,
        )
        .get(workflow.runId) as {
          run_id: string;
          status: "succeeded" | "failed" | "skipped";
          artifact_id: string | null;
          error_code: string | null;
          error_message: string | null;
          parser_strategy: string | null;
          parser_confidence: number | null;
          page_count: number | null;
          observation_count: number;
        };
      completed.set(document.publication_id, {
        ...document,
        ...record,
        fetched_sha256: fetchedSha256,
        archive_checksum_changed: Boolean(document.archive_sha256 && document.archive_sha256 !== fetchedSha256),
        duration_ms: Date.now() - started,
      });
    } catch (error) {
      completed.set(document.publication_id, {
        ...document,
        run_id: null,
        status: "fetch_failed",
        artifact_id: null,
        observation_count: 0,
        parser_strategy: null,
        parser_confidence: null,
        page_count: null,
        error_code: "VALIDATION_FETCH_FAILED",
        error_message: error instanceof Error ? error.message : String(error),
        fetched_sha256: fetchedSha256,
        archive_checksum_changed: Boolean(document.archive_sha256 && fetchedSha256 && document.archive_sha256 !== fetchedSha256),
        duration_ms: Date.now() - started,
      });
    }
    await saveResults([...completed.values()]);
    const latest = completed.get(document.publication_id)!;
    console.log(JSON.stringify({
      progress: `${index + 1}/${documents.length}`,
      date: document.published_date,
      status: latest.status,
      observations: latest.observation_count,
      error: latest.error_code,
    }));
  }

  const final = [...completed.values()];
  await saveResults(final);
  console.log(JSON.stringify({
    batch_id: batchId,
    selected: documents.length,
    succeeded: final.filter((result) => result.status === "succeeded").length,
    failed: final.filter((result) => result.status !== "succeeded").length,
    observations: final.reduce((total, result) => total + result.observation_count, 0),
  }));
} finally {
  database.close();
}

async function loadOrCreateSample(): Promise<SampleDocument[]> {
  try {
    const saved = JSON.parse(await readFile(samplePath, "utf8")) as { documents: SampleDocument[] };
    return saved.documents;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const documents = database
    .prepare(
      `SELECT publication.id AS publication_id, publication.title,
       substr(publication.published_at, 1, 10) AS published_date,
       archive.id AS archive_id, archive.r2_key, archive.source_url, archive.sha256 AS archive_sha256
       FROM source_publication publication
       JOIN archived_pdf archive ON archive.publication_id = publication.id
       WHERE publication.published_at >= ? AND publication.published_at < date(?, '+1 day')
         AND NOT EXISTS (
           SELECT 1 FROM ingest_run run
           WHERE run.archive_id = archive.id AND run.workflow = 'pdf_processing' AND run.status = 'succeeded'
         )
       ORDER BY random() LIMIT ?`,
    )
    .all(windowStart, windowEnd, sampleSize) as SampleDocument[];
  if (documents.length !== sampleSize) throw new Error(`SAMPLE_TOO_SMALL: expected ${sampleSize}, found ${documents.length}`);
  const selectedAt = new Date().toISOString();
  await writeFile(samplePath, `${JSON.stringify({
    batch_id: batchId,
    selected_at: selectedAt,
    window: { from: windowStart, to: windowEnd },
    sampling_method: "SQLite ORDER BY random(), excluding previously successful PDF-processing runs",
    sample_size: sampleSize,
    documents,
  }, null, 2)}\n`);
  await writeFile(sampleCsvPath, toCsv(documents));
  return documents;
}

async function loadExistingResults(): Promise<{ documents: DocumentResult[] }> {
  try {
    return JSON.parse(await readFile(resultsPath, "utf8")) as { documents: DocumentResult[] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { documents: [] };
    throw error;
  }
}

async function saveResults(documents: DocumentResult[]): Promise<void> {
  const ordered = [...documents].sort((left, right) => left.published_date.localeCompare(right.published_date));
  await writeFile(resultsPath, `${JSON.stringify({
    batch_id: batchId,
    updated_at: new Date().toISOString(),
    documents: ordered,
  }, null, 2)}\n`);
}

function toCsv(documents: SampleDocument[]): string {
  const columns: Array<keyof SampleDocument> = [
    "publication_id",
    "published_date",
    "title",
    "archive_id",
    "r2_key",
    "source_url",
    "archive_sha256",
  ];
  const rows = documents.map((document) => columns.map((column) => csvCell(document[column])).join(","));
  return `${columns.join(",")}\n${rows.join("\n")}\n`;
}

function csvCell(value: string | null): string {
  const text = value ?? "";
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
