import { createHash } from "node:crypto";

import { canPublishSource, type MappingBundle, type SourceManifest, type StageName } from "@lanka-pricelens/shared";
import { hartiArchiveObjectKey } from "@lanka-pricelens/shared/harti-archive";

import { finalizeProcessedArtifacts, persistExtractedText, persistProcessedArtifact } from "./artifact.ts";
import { configuredArchiveStorage, type ArchiveStorage } from "./archive-storage.ts";
import {
  blockStage,
  finishRun,
  finishStage,
  heartbeatRun,
  logStage,
  newId,
  startRun,
  startStage,
  syncSource,
  type OperationalDatabase,
} from "./db.ts";
import { discoverHartiDaily, HartiParseError, parseHartiWholesaleWithDiagnostics, type Publication } from "./harti.ts";
import { inspectPdf, type TextItem } from "./pdf.ts";
import { canonicalizeArtifact } from "./mapping.ts";
import { assessArtifactCompleteness } from "./quality.ts";

export const sourceSyncStages = [
  "check_source",
  "compare_inventory",
  "download_new_pdfs",
  "upload_to_r2",
  "record_pdf_metadata",
] as const satisfies readonly StageName[];
export const processingStages = [
  "retrieve_pdf",
  "parse_pdf",
  "extract_data",
  "validate_data",
  "insert_data",
  "assess_completeness",
  "canonicalize_data",
] as const satisfies readonly StageName[];
const legacyStages = ["crawl", "download", "process", "validate", "store"] as const satisfies readonly StageName[];

export type SourceSyncStage = (typeof sourceSyncStages)[number];
export type ProcessingStage = (typeof processingStages)[number];
export type WorkflowStage = SourceSyncStage | ProcessingStage;

type StoredArchiveObject = Awaited<ReturnType<ArchiveStorage["list"]>> extends Map<string, infer Object> ? Object : never;
export type { ArchiveStorage } from "./archive-storage.ts";

export type IngestionOptions = {
  trigger: "scheduled" | "manual" | "backfill";
  from?: string | undefined;
  to?: string | undefined;
  request?: typeof fetch | undefined;
  inspector?: typeof inspectPdf | undefined;
  archive?: ArchiveStorage | undefined;
  artifactRoot?: string | undefined;
  limit?: number | undefined;
  mappingBundle?: MappingBundle | undefined;
  execution?: WorkflowExecutionOptions | undefined;
};

export type WorkflowExecutionOptions = {
  definitionKey: string;
  definitionVersion: number;
  dispatchId: string;
  scheduledFor: string;
  environment: string;
};

type StageResult = { outputCount: number; warningCount?: number; output: Record<string, unknown> };
type RetryState = { canRetry: boolean; reason: string | null; missingDependencies: string[] };
type ProcessingResult = { runId: string; status: "succeeded" | "failed" | "blocked" | "skipped" };

type DownloadedPdf = {
  publication: Publication;
  bytes: Uint8Array;
  sha256: string;
  contentType: string;
  finalUrl: string;
  etag: string | null;
  lastModified: string | null;
};

type SourceSyncContext = {
  publications: Publication[];
  inventory: Map<string, StoredArchiveObject>;
  pending: Publication[];
  reconcile: Publication[];
  downloaded: Map<string, DownloadedPdf>;
  uploaded: Set<string>;
  newArchiveIds: string[];
};

type ProcessingContext = {
  archiveId: string;
  artifactId: string | null;
  bytes: Uint8Array | null;
  items: TextItem[] | null;
};

const processingDependencies: Record<ProcessingStage, ProcessingStage[]> = {
  retrieve_pdf: [],
  parse_pdf: ["retrieve_pdf"],
  extract_data: ["parse_pdf"],
  validate_data: ["extract_data"],
  insert_data: ["validate_data"],
  assess_completeness: ["insert_data"],
  canonicalize_data: ["assess_completeness"],
};

export async function runIngestion(
  database: OperationalDatabase,
  manifest: SourceManifest,
  options: IngestionOptions,
): Promise<{ runId: string; status: "succeeded" | "blocked" | "skipped"; processingRunIds: string[] }> {
  return runSourceSync(database, manifest, options);
}

export async function runSourceSync(
  database: OperationalDatabase,
  manifest: SourceManifest,
  options: IngestionOptions,
): Promise<{ runId: string; status: "succeeded" | "blocked" | "skipped"; processingRunIds: string[] }> {
  syncSource(database, manifest);
  const run = startRun(database, {
    sourceId: manifest.id,
    trigger: options.trigger,
    workflow: "source_sync",
    ...options.execution,
    from: options.from,
    to: options.to,
  });
  if (!run.started) return { runId: run.id, status: "skipped", processingRunIds: [] };

  if (!canPublishSource(manifest)) {
    const message = "Source is disabled, unapproved, or its rights review has expired";
    startStage(database, run.id, "check_source", 1, { source_url: manifest.landing_url });
    finishStage(database, run.id, "check_source", "blocked", { errorCode: "SOURCE_RIGHTS_BLOCKED", errorMessage: message });
    logStage(database, run.id, "check_source", "error", message);
    blockStages(database, run.id, sourceSyncStages, "check_source");
    finishRun(database, run.id, "blocked", { code: "SOURCE_RIGHTS_BLOCKED", message });
    database.prepare("UPDATE source SET state = 'blocked', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifest.id);
    return { runId: run.id, status: "blocked", processingRunIds: [] };
  }

  const storage = options.archive ?? await configuredArchiveStorage();
  const context: SourceSyncContext = {
    publications: [],
    inventory: new Map(),
    pending: [],
    reconcile: [],
    downloaded: new Map(),
    uploaded: new Set(),
    newArchiveIds: [],
  };

  try {
    for (const stage of sourceSyncStages) await executeSourceSyncStage(database, run.id, manifest, stage, options, storage, context);
    const now = new Date().toISOString();
    database
      .prepare(
        "UPDATE source SET state = 'healthy', last_fetch_at = CASE WHEN ? > 0 THEN ? ELSE last_fetch_at END, updated_at = ? WHERE id = ?",
      )
      .run(context.uploaded.size, now, now, manifest.id);
    finishRun(database, run.id, "succeeded");
  } catch (error) {
    const message = errorMessage(error);
    finishRun(database, run.id, "failed", { code: "SOURCE_SYNC_FAILED", message });
    database.prepare("UPDATE source SET state = 'degraded', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifest.id);
    throw error;
  }

  const processingRunIds: string[] = [];
  for (const archiveId of context.newArchiveIds) {
    const result = await runPdfProcessing(database, manifest, archiveId, {
      trigger: options.trigger,
      parentRunId: run.id,
      archive: storage,
      inspector: options.inspector,
      mappingBundle: options.mappingBundle,
      execution: options.execution,
    });
    processingRunIds.push(result.runId);
  }
  return { runId: run.id, status: "succeeded", processingRunIds };
}

export async function runPdfProcessing(
  database: OperationalDatabase,
  manifest: SourceManifest,
  archiveId: string,
  options: {
    trigger: "scheduled" | "manual" | "backfill";
    parentRunId?: string | undefined;
    archive?: ArchiveStorage | undefined;
    inspector?: typeof inspectPdf | undefined;
    mappingBundle?: MappingBundle | undefined;
    execution?: WorkflowExecutionOptions | undefined;
  },
): Promise<ProcessingResult> {
  syncSource(database, manifest);
  const archived = archivedPdf(database, archiveId);
  if (!archived) throw new Error("ARCHIVED_PDF_NOT_FOUND");
  const run = startRun(database, {
    sourceId: manifest.id,
    trigger: options.trigger,
    workflow: "pdf_processing",
    parentRunId: options.parentRunId,
    archiveId,
    ...options.execution,
  });
  if (!run.started) return { runId: run.id, status: "skipped" };

  if (!canPublishSource(manifest)) {
    const message = "Source processing is blocked by its rights policy";
    startStage(database, run.id, "retrieve_pdf", 1, { archive_id: archiveId });
    finishStage(database, run.id, "retrieve_pdf", "blocked", { errorCode: "SOURCE_RIGHTS_BLOCKED", errorMessage: message });
    blockStages(database, run.id, processingStages, "retrieve_pdf");
    finishRun(database, run.id, "blocked", { code: "SOURCE_RIGHTS_BLOCKED", message });
    return { runId: run.id, status: "blocked" };
  }

  const storage = options.archive ?? await configuredArchiveStorage(archived.r2_bucket);
  const context: ProcessingContext = { archiveId, artifactId: null, bytes: null, items: null };
  try {
    for (const stage of processingStages) {
      await executeProcessingStage(database, run.id, manifest, stage, storage, context, options.inspector, options.mappingBundle);
    }
    completeProcessingRun(database, run.id, manifest.id);
    return { runId: run.id, status: "succeeded" };
  } catch (error) {
    const message = errorMessage(error);
    const quarantineReason = processingQuarantineReason(error);
    if (quarantineReason && context.artifactId) {
      recordProcessingQuarantine(database, run.id, context.artifactId, quarantineReason, error);
      finishRun(database, run.id, "blocked", { code: quarantineReason, message });
      database.prepare("UPDATE source SET state = 'degraded', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifest.id);
      return { runId: run.id, status: "blocked" };
    }
    finishRun(database, run.id, "failed", { code: "PDF_PROCESSING_FAILED", message });
    database.prepare("UPDATE source SET state = 'degraded', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifest.id);
    return { runId: run.id, status: "failed" };
  }
}

export async function retryProcessingStage(
  database: OperationalDatabase,
  manifest: SourceManifest,
  runId: string,
  stage: ProcessingStage,
  options: {
    archive?: ArchiveStorage | undefined;
    inspector?: typeof inspectPdf | undefined;
    mappingBundle?: MappingBundle | undefined;
  } = {},
): Promise<void> {
  const retry = workflowRetryState(database, runId, stage);
  if (!retry.canRetry) throw new Error(`WORKFLOW_RETRY_BLOCKED: ${retry.reason ?? "Step cannot be retried"}`);
  const run = database
    .prepare("SELECT archive_id, artifact_id FROM ingest_run WHERE id = ? AND workflow = 'pdf_processing'")
    .get(runId) as { archive_id: string; artifact_id: string | null } | undefined;
  if (!run) throw new Error("RUN_NOT_FOUND");
  const archived = archivedPdf(database, run.archive_id);
  if (!archived) throw new Error("ARCHIVED_PDF_NOT_FOUND");
  const storage = options.archive ?? await configuredArchiveStorage(archived.r2_bucket);

  const now = new Date();
  database
    .prepare(
      `UPDATE ingest_run SET status = 'running', finished_at = NULL, heartbeat_at = ?, lease_expires_at = ?,
       error_code = NULL, error_message = NULL WHERE id = ?`,
    )
    .run(now.toISOString(), new Date(now.getTime() + 30 * 60_000).toISOString(), runId);
  invalidateProcessingOutputs(database, run.artifact_id, stage);
  blockStages(database, runId, processingStages, stage);

  const context: ProcessingContext = {
    archiveId: run.archive_id,
    artifactId: run.artifact_id,
    bytes: null,
    items: null,
  };
  try {
    await executeProcessingStage(database, runId, manifest, stage, storage, context, options.inspector, options.mappingBundle);
    const incomplete = processingStages.some((candidate) => stageStatus(database, runId, candidate) !== "succeeded");
    if (incomplete) {
      finishRun(database, runId, "blocked", {
        code: "WORKFLOW_INCOMPLETE",
        message: "A downstream step is waiting for its dependency",
      });
    } else {
      completeProcessingRun(database, runId, manifest.id);
    }
  } catch (error) {
    finishRun(database, runId, "failed", { code: "PDF_PROCESSING_FAILED", message: errorMessage(error) });
    throw error;
  }
}

export function workflowRetryState(database: OperationalDatabase, runId: string, stage: ProcessingStage): RetryState {
  const run = database.prepare("SELECT status, workflow, artifact_id FROM ingest_run WHERE id = ?").get(runId) as
    | { status: string; workflow: string; artifact_id: string | null }
    | undefined;
  if (!run) return { canRetry: false, reason: "Run not found", missingDependencies: [] };
  if (run.workflow !== "pdf_processing") return { canRetry: false, reason: "Only PDF-processing steps can be retried", missingDependencies: [] };
  if (run.status === "running") return { canRetry: false, reason: "The workflow is currently running", missingDependencies: [] };

  const current = database.prepare("SELECT status FROM run_stage WHERE run_id = ? AND stage = ?").get(runId, stage) as
    | { status: string }
    | undefined;
  if (!current) return { canRetry: false, reason: "No execution data exists for this step", missingDependencies: [] };
  if (!["failed", "blocked"].includes(current.status)) {
    return { canRetry: false, reason: `The step is ${current.status}`, missingDependencies: [] };
  }

  const missing: string[] = processingDependencies[stage].filter((dependency) => stageStatus(database, runId, dependency) !== "succeeded");
  missing.push(...missingProcessingInputs(database, run.artifact_id, stage));
  const unique = [...new Set(missing)];
  return {
    canRetry: unique.length === 0,
    reason: unique.length ? `Missing required input${unique.length === 1 ? "" : "s"}: ${unique.join(", ")}` : null,
    missingDependencies: unique,
  };
}

export function workflowSnapshot(database: OperationalDatabase, runId: string): Array<Record<string, unknown>> {
  const run = database.prepare("SELECT workflow FROM ingest_run WHERE id = ?").get(runId) as { workflow: string } | undefined;
  if (!run) return [];
  const stages: readonly StageName[] = run.workflow === "source_sync"
    ? sourceSyncStages
    : run.workflow === "pdf_processing"
      ? processingStages
      : legacySnapshotStages(database, runId);

  return stages.map((stage) => {
    const row = database.prepare("SELECT * FROM run_stage WHERE run_id = ? AND stage = ?").get(runId, stage) as
      | Record<string, unknown>
      | undefined;
    const logs = database
      .prepare(
        `SELECT id, level, message, data_json, created_at FROM (
          SELECT id, level, message, data_json, created_at FROM run_stage_log
          WHERE run_id = ? AND stage = ? ORDER BY id DESC LIMIT 200
        ) ORDER BY id`,
      )
      .all(runId, stage) as Array<Record<string, unknown>>;
    const retry = run.workflow === "pdf_processing" && processingStages.includes(stage as ProcessingStage)
      ? workflowRetryState(database, runId, stage as ProcessingStage)
      : { canRetry: false, reason: run.workflow === "source_sync" ? "Rerun the source-sync workflow" : "Legacy run is read-only", missingDependencies: [] };
    const startedAt = typeof row?.started_at === "string" ? row.started_at : null;
    const finishedAt = typeof row?.finished_at === "string" ? row.finished_at : null;
    return {
      ...row,
      stage,
      status: row?.status ?? "blocked",
      error_code: row?.error_code ?? (row ? null : "NO_EXECUTION_DATA"),
      error_message: row?.error_message ?? (row ? null : "No execution data is available for this step"),
      input: parseJson(row?.input_json),
      output: parseJson(row?.output_json),
      duration_ms: startedAt && finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : null,
      can_retry: retry.canRetry,
      retry_reason: retry.reason,
      missing_dependencies: retry.missingDependencies,
      logs: logs.map((log) => ({ ...log, data: parseJson(log.data_json) })),
      log_count: count(database, "SELECT COUNT(*) AS count FROM run_stage_log WHERE run_id = ? AND stage = ?", runId, stage),
    };
  });
}

async function executeSourceSyncStage(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  stage: SourceSyncStage,
  options: IngestionOptions,
  storage: ArchiveStorage,
  context: SourceSyncContext,
): Promise<void> {
  const input = sourceSyncInput(manifest, stage, options, context);
  await executeLoggedStage(database, runId, stage, sourceSyncInputCount(stage, context), input, async () => {
    if (stage === "check_source") return checkSource(database, runId, manifest, options, context);
    if (stage === "compare_inventory") return compareInventory(database, runId, options, storage, context);
    if (stage === "download_new_pdfs") return downloadNewPdfs(database, runId, manifest, options, context);
    if (stage === "upload_to_r2") return uploadToR2(database, runId, storage, context);
    return recordPdfMetadata(database, runId, manifest, storage, context);
  }, sourceSyncStages);
}

async function executeProcessingStage(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  stage: ProcessingStage,
  storage: ArchiveStorage,
  context: ProcessingContext,
  inspector?: typeof inspectPdf,
  mappingBundle?: MappingBundle,
): Promise<void> {
  const input = processingInput(database, context, stage);
  await executeLoggedStage(database, runId, stage, processingInputCount(database, context, stage), input, async () => {
    if (stage === "retrieve_pdf") return retrievePdf(database, runId, storage, context);
    if (stage === "parse_pdf") return parsePdf(database, storage, context, inspector);
    if (stage === "extract_data") return extractData(database, runId, context);
    if (stage === "validate_data") return validateData(database, context);
    if (stage === "insert_data") return insertData(database, runId, context);
    if (stage === "assess_completeness") return assessCompleteness(database, runId, context, mappingBundle);
    return canonicalizeData(database, runId, context, mappingBundle);
  }, processingStages);
  heartbeatRun(database, runId);
  void manifest;
}

async function executeLoggedStage(
  database: OperationalDatabase,
  runId: string,
  stage: StageName,
  inputCount: number,
  input: Record<string, unknown>,
  operation: () => Promise<StageResult> | StageResult,
  workflow: readonly StageName[],
): Promise<void> {
  startStage(database, runId, stage, inputCount, input);
  logStage(database, runId, stage, "info", `${stageLabel(stage)} started`, input);
  try {
    const result = await operation();
    finishStage(database, runId, stage, "succeeded", {
      outputCount: result.outputCount,
      ...(result.warningCount === undefined ? {} : { warningCount: result.warningCount }),
      output: result.output,
    });
    logStage(database, runId, stage, "info", `${stageLabel(stage)} succeeded`, result.output);
  } catch (error) {
    const message = errorMessage(error);
    const code = error instanceof HartiParseError ? error.code : `${stage.toUpperCase()}_FAILED`;
    const details = {
      code,
      message,
      ...(error instanceof HartiParseError ? { rejected_candidates: error.rejectedCandidates } : {}),
    };
    finishStage(database, runId, stage, "failed", { errorCode: code, errorMessage: message, output: details });
    logStage(database, runId, stage, "error", `${stageLabel(stage)} failed`, details);
    blockStages(database, runId, workflow, stage);
    throw error;
  }
}

async function checkSource(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  options: IngestionOptions,
  context: SourceSyncContext,
): Promise<StageResult> {
  const request = options.request ?? fetch;
  const landing = await requestWithRetry(request, manifest.landing_url, manifest.max_attempts, manifest.request_interval_ms);
  const html = new TextDecoder().decode(await limitedBody(landing, 5 * 1024 * 1024));
  context.publications = discoverHartiDaily(html, manifest.landing_url, { from: options.from, to: options.to });
  recordPublications(database, manifest.id, context.publications);
  const now = new Date().toISOString();
  database.prepare("UPDATE ingest_run SET discovered_count = ? WHERE id = ?").run(context.publications.length, runId);
  database.prepare("UPDATE source SET last_discovery_at = ?, updated_at = ? WHERE id = ?").run(now, now, manifest.id);
  return { outputCount: context.publications.length, output: { discovered: context.publications.length } };
}

async function compareInventory(
  database: OperationalDatabase,
  runId: string,
  options: IngestionOptions,
  storage: ArchiveStorage,
  context: SourceSyncContext,
): Promise<StageResult> {
  context.inventory = await storage.list();
  const recorded = new Set(
    (database.prepare("SELECT r2_key FROM archived_pdf").all() as Array<{ r2_key: string }>).map((row) => row.r2_key),
  );
  const missing: Publication[] = [];
  context.reconcile = [];
  for (const publication of context.publications) {
    const key = archiveKey(publication);
    if (recorded.has(key)) continue;
    if (context.inventory.has(key)) context.reconcile.push(publication);
    else missing.push(publication);
  }
  const knownKeys = new Set([...recorded, ...context.inventory.keys()]);
  const missingKeys = new Set(missing.map((publication) => publication.key));
  const newestKnownIndex = context.publications.findIndex((publication) => knownKeys.has(archiveKey(publication)));
  context.pending = options.trigger !== "backfill" && !options.from && !options.to
    ? newestKnownIndex < 0
      ? missing.slice(0, 1)
      : context.publications.slice(0, newestKnownIndex).filter((publication) => missingKeys.has(publication.key))
    : missing;
  if (options.limit !== undefined) context.pending = context.pending.slice(0, Math.max(0, options.limit));
  recordRunPublications(database, runId, context.pending);
  return {
    outputCount: context.pending.length,
    output: {
      source_pdfs: context.publications.length,
      recorded: recorded.size,
      stored_in_r2: context.inventory.size,
      metadata_to_reconcile: context.reconcile.length,
      new_pdfs: context.pending.length,
    },
  };
}

async function downloadNewPdfs(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  options: IngestionOptions,
  context: SourceSyncContext,
): Promise<StageResult> {
  const request = options.request ?? fetch;
  for (const [index, publication] of context.pending.entries()) {
    if (index > 0) await delay(manifest.request_interval_ms);
    const response = await requestWithRetry(request, publication.downloadUrl, manifest.max_attempts, manifest.request_interval_ms);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "application/octet-stream";
    if (!["application/pdf", "application/octet-stream"].includes(contentType)) throw new Error("SOURCE_MEDIA_TYPE_INVALID");
    const bytes = await limitedBody(response, 20 * 1024 * 1024);
    if (!isPdf(bytes)) throw new Error("SOURCE_NOT_PDF");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    context.downloaded.set(publication.key, {
      publication,
      bytes,
      sha256,
      contentType,
      finalUrl: response.url || publication.downloadUrl,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    });
    logStage(database, runId, "download_new_pdfs", "info", "New PDF downloaded", {
      publication_key: publication.key,
      source_url: publication.downloadUrl,
      byte_size: bytes.byteLength,
      sha256,
    });
    heartbeatRun(database, runId);
  }
  database.prepare("UPDATE ingest_run SET fetched_count = ? WHERE id = ?").run(context.downloaded.size, runId);
  return { outputCount: context.downloaded.size, output: { downloaded: context.downloaded.size } };
}

async function uploadToR2(
  database: OperationalDatabase,
  runId: string,
  storage: ArchiveStorage,
  context: SourceSyncContext,
): Promise<StageResult> {
  for (const downloaded of context.downloaded.values()) {
    const key = archiveKey(downloaded.publication);
    await storage.upload(key, downloaded.publication.title, downloaded.bytes, {
      "source-url": downloaded.publication.downloadUrl,
      "source-date": downloaded.publication.date,
      sha256: downloaded.sha256,
    });
    context.uploaded.add(downloaded.publication.key);
    logStage(database, runId, "upload_to_r2", "info", "PDF uploaded to R2", {
      publication_key: downloaded.publication.key,
      r2_uri: archiveUri(storage, key),
      byte_size: downloaded.bytes.byteLength,
    });
    heartbeatRun(database, runId);
  }
  return { outputCount: context.uploaded.size, output: { bucket: storage.bucket, uploaded: context.uploaded.size } };
}

function recordPdfMetadata(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  storage: ArchiveStorage,
  context: SourceSyncContext,
): StageResult {
  const publications = [...context.reconcile, ...context.pending];
  const now = new Date().toISOString();
  const inserted = database.transaction(() => {
    const archiveIds: string[] = [];
    const statement = database.prepare(
      `INSERT INTO archived_pdf (
        id, publication_id, source_sync_run_id, source_url, r2_bucket, r2_key, r2_uri,
        byte_size, sha256, etag, uploaded_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?)
      ON CONFLICT(publication_id) DO UPDATE SET
        source_url = excluded.source_url, r2_bucket = excluded.r2_bucket, r2_key = excluded.r2_key,
        r2_uri = excluded.r2_uri, byte_size = COALESCE(excluded.byte_size, archived_pdf.byte_size),
        sha256 = COALESCE(excluded.sha256, archived_pdf.sha256), etag = COALESCE(excluded.etag, archived_pdf.etag),
        uploaded_at = COALESCE(excluded.uploaded_at, archived_pdf.uploaded_at), status = 'stored',
        updated_at = excluded.updated_at`,
    );
    for (const publication of publications) {
      const key = archiveKey(publication);
      const downloaded = context.downloaded.get(publication.key);
      const existing = context.inventory.get(key);
      const archiveId = `archive_${publication.key}`;
      statement.run(
        archiveId,
        `publication_${publication.key}`,
        runId,
        publication.downloadUrl,
        storage.bucket,
        key,
        archiveUri(storage, key),
        downloaded?.bytes.byteLength ?? existing?.size ?? null,
        downloaded?.sha256 ?? existing?.customMetadata.sha256 ?? null,
        downloaded?.etag ?? existing?.etag ?? null,
        existing?.lastModified ?? (downloaded ? now : null),
        now,
        now,
      );
      database.prepare("UPDATE source_publication SET status = 'archived', last_seen_at = ? WHERE id = ?").run(now, `publication_${publication.key}`);
      if (context.uploaded.has(publication.key)) archiveIds.push(archiveId);
    }
    return archiveIds;
  })();
  context.newArchiveIds = inserted;
  database.prepare("UPDATE source SET updated_at = ? WHERE id = ?").run(now, manifest.id);
  return {
    outputCount: publications.length,
    output: { recorded: publications.length, reconciled: context.reconcile.length, processing_triggered: inserted.length },
  };
}

async function retrievePdf(
  database: OperationalDatabase,
  runId: string,
  storage: ArchiveStorage,
  context: ProcessingContext,
): Promise<StageResult> {
  const archived = archivedPdf(database, context.archiveId);
  if (!archived) throw new Error("ARCHIVED_PDF_NOT_FOUND");
  const bytes = await storage.download(archived.r2_key);
  if (!isPdf(bytes)) throw new Error("R2_OBJECT_NOT_PDF");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (archived.sha256 && archived.sha256 !== sha256) throw new Error("R2_CHECKSUM_MISMATCH");
  const artifactId = `artifact_${archived.publication_key}_${sha256.slice(0, 12)}`;
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO source_artifact (
        id, publication_id, run_id, requested_url, final_url, fetched_at, media_type,
        byte_size, sha256, storage_ref, original_filename, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, 'fetched')
      ON CONFLICT(publication_id, sha256) DO UPDATE SET
        run_id = excluded.run_id, requested_url = excluded.requested_url, final_url = excluded.final_url,
        fetched_at = excluded.fetched_at, byte_size = excluded.byte_size, storage_ref = excluded.storage_ref,
        original_filename = excluded.original_filename, status = 'fetched'`,
    )
    .run(
      artifactId,
      archived.publication_id,
      runId,
      archived.source_url,
      archived.r2_uri,
      now,
      bytes.byteLength,
      sha256,
      archived.r2_uri,
      archived.title,
    );
  const stored = database
    .prepare("SELECT id FROM source_artifact WHERE publication_id = ? AND sha256 = ?")
    .get(archived.publication_id, sha256) as { id: string };
  database.prepare("UPDATE ingest_run SET artifact_id = ?, fetched_count = 1 WHERE id = ?").run(stored.id, runId);
  database.prepare("UPDATE archived_pdf SET sha256 = ?, byte_size = ?, updated_at = ? WHERE id = ?").run(sha256, bytes.byteLength, now, context.archiveId);
  context.artifactId = stored.id;
  context.bytes = bytes;
  return { outputCount: 1, output: { artifact_id: stored.id, r2_uri: archived.r2_uri, byte_size: bytes.byteLength, sha256 } };
}

async function parsePdf(
  database: OperationalDatabase,
  storage: ArchiveStorage,
  context: ProcessingContext,
  pdfInspector: typeof inspectPdf = inspectPdf,
): Promise<StageResult> {
  const artifactId = requiredArtifact(context);
  const archived = archivedPdf(database, context.archiveId);
  if (!archived) throw new Error("ARCHIVED_PDF_NOT_FOUND");
  const bytes = context.bytes ?? await storage.download(archived.r2_key);
  const extraction = await pdfInspector(bytes);
  if (!extraction.items.length && extraction.inspection.pagesNeedingOcr.length) {
    throw new Error(`PDF_OCR_REQUIRED: pages ${extraction.inspection.pagesNeedingOcr.join(",")}`);
  }
  persistExtractedText(database, artifactId, extraction.items);
  database.prepare("UPDATE source_artifact SET inspection_json = ?, status = 'processed' WHERE id = ?").run(
    JSON.stringify(extraction.inspection),
    artifactId,
  );
  context.bytes = bytes;
  context.items = extraction.items;
  return {
    outputCount: extraction.items.length,
    output: {
      engine: extraction.inspection.engine,
      pages: extraction.inspection.pageCount,
      text_items: extraction.items.length,
      pages_needing_ocr: extraction.inspection.pagesNeedingOcr,
    },
  };
}

function extractData(database: OperationalDatabase, runId: string, context: ProcessingContext): StageResult {
  const artifactId = requiredArtifact(context);
  const items = context.items ?? extractedItems(database, artifactId);
  if (!items.length) throw new Error("PARSED_PDF_INPUT_MISSING");
  const parsed = parseHartiWholesaleWithDiagnostics(items);
  persistProcessedArtifact(database, { artifactId, runId, items, observations: parsed.observations });
  database
    .prepare(
      `UPDATE source_artifact SET parser_strategy = ?, parser_confidence = ?, parser_diagnostics_json = ?
       WHERE id = ?`,
    )
    .run(parsed.diagnostics.strategy, parsed.diagnostics.confidence, JSON.stringify(parsed.diagnostics), artifactId);
  context.items = items;
  return {
    outputCount: parsed.observations.length,
    warningCount: parsed.diagnostics.warnings.length,
    output: {
      structured_records: parsed.observations.length,
      parser_strategy: parsed.diagnostics.strategy,
      parser_confidence: parsed.diagnostics.confidence,
      parser_page: parsed.diagnostics.page,
      parser_signals: parsed.diagnostics.signals,
      parser_warnings: parsed.diagnostics.warnings,
    },
  };
}

function validateData(database: OperationalDatabase, context: ProcessingContext): StageResult {
  const artifactId = requiredArtifact(context);
  const total = count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", artifactId);
  const invalid = count(
    database,
    `SELECT COUNT(*) AS count FROM staging_observation
     WHERE artifact_id = ? AND status != 'stale' AND (
       min_value_minor <= 0 OR max_value_minor <= 0 OR min_value_minor > max_value_minor OR length(source_date) != 10
     )`,
    artifactId,
  );
  if (!total || invalid) throw new Error(`VALIDATION_FAILED: ${invalid} invalid records, ${total} total records`);
  database.prepare("UPDATE staging_observation SET status = 'validated' WHERE artifact_id = ? AND status != 'stale'").run(artifactId);
  database.prepare("UPDATE source_artifact SET status = 'validated' WHERE id = ?").run(artifactId);
  return { outputCount: total, output: { validated: total, errors: 0 } };
}

function insertData(database: OperationalDatabase, runId: string, context: ProcessingContext): StageResult {
  const artifactId = requiredArtifact(context);
  const invalid = count(
    database,
    "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status NOT IN ('validated', 'stale')",
    artifactId,
  );
  if (invalid) throw new Error("VALIDATED_DATA_INPUT_MISSING");
  const total = count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", artifactId);
  if (!total) throw new Error("VALIDATED_DATA_INPUT_MISSING");
  finalizeProcessedArtifacts(database, runId, [artifactId]);
  return { outputCount: total, output: { inserted: total, artifact_id: artifactId } };
}

function assessCompleteness(
  database: OperationalDatabase,
  runId: string,
  context: ProcessingContext,
  bundle?: MappingBundle,
): StageResult {
  const artifactId = requiredArtifact(context);
  const assessment = assessArtifactCompleteness(database, runId, artifactId, bundle);
  return {
    outputCount: assessment.observedCells,
    warningCount: assessment.status === "complete" ? 0 : 1,
    output: {
      artifact_id: artifactId,
      status: assessment.status,
      score: assessment.score,
      item_coverage: assessment.itemCoverage,
      market_coverage: assessment.marketCoverage,
      cell_coverage: assessment.cellCoverage,
      mapping_coverage: assessment.mappingCoverage,
      expected_items: assessment.expectedItems,
      observed_items: assessment.observedItems,
      expected_markets: assessment.expectedMarkets,
      observed_markets: assessment.observedMarkets,
      expected_cells: assessment.expectedCells,
      observed_cells: assessment.observedCells,
      unknown_items: assessment.unknownItems,
      unknown_markets: assessment.unknownMarkets,
      unknown_units: assessment.unknownUnits,
    },
  };
}

function canonicalizeData(
  database: OperationalDatabase,
  runId: string,
  context: ProcessingContext,
  bundle?: MappingBundle,
): StageResult {
  const artifactId = requiredArtifact(context);
  if (!bundle) {
    const records = count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", artifactId);
    return {
      outputCount: 0,
      warningCount: records,
      output: { artifact_id: artifactId, status: "not_configured", canonicalized: 0, retained_in_staging: records },
    };
  }
  const parser = database
    .prepare("SELECT parser_strategy FROM source_artifact WHERE id = ?")
    .get(artifactId) as { parser_strategy: string | null } | undefined;
  const result = canonicalizeArtifact(
    database,
    runId,
    artifactId,
    bundle,
    `harti-adaptive@2:${parser?.parser_strategy ?? "unknown"}`,
  );
  const canonicalized = result.accepted + result.corrected + result.historical;
  database.prepare("UPDATE source_artifact SET status = 'canonicalized' WHERE id = ?").run(artifactId);
  database
    .prepare("UPDATE source_publication SET status = 'canonicalized' WHERE id = (SELECT publication_id FROM source_artifact WHERE id = ?)")
    .run(artifactId);
  return {
    outputCount: canonicalized,
    warningCount: result.quarantined,
    output: { artifact_id: artifactId, status: "canonicalized", canonicalized, ...result },
  };
}

function completeProcessingRun(database: OperationalDatabase, runId: string, sourceId: string): void {
  resolveRecoveredProcessingQuarantines(database, runId);
  updateProcessingCounts(database, runId);
  const now = new Date().toISOString();
  database.prepare("UPDATE source SET state = 'healthy', last_parse_at = ?, updated_at = ? WHERE id = ?").run(now, now, sourceId);
  finishRun(database, runId, "succeeded");
}

function processingQuarantineReason(error: unknown): string | null {
  if (error instanceof HartiParseError) return error.code;
  const message = errorMessage(error);
  for (const code of ["PDF_OCR_REQUIRED", "SOURCE_TEMPLATE_CHANGED", "UNSUPPORTED_DOCUMENT", "PDF_PARSE_FAILED"] as const) {
    if (message === code || message.startsWith(`${code}:`)) return code;
  }
  return null;
}

function recordProcessingQuarantine(
  database: OperationalDatabase,
  runId: string,
  artifactId: string,
  reasonCode: string,
  error: unknown,
): void {
  const now = new Date().toISOString();
  const details = {
    message: errorMessage(error),
    ...(error instanceof HartiParseError ? { rejected_candidates: error.rejectedCandidates } : {}),
  };
  database.transaction(() => {
    const existing = database
      .prepare("SELECT 1 FROM quarantine WHERE artifact_id = ? AND reason_code = ? AND status = 'open'")
      .get(artifactId, reasonCode);
    if (!existing) {
      database
        .prepare(
          `INSERT INTO quarantine (id, run_id, artifact_id, reason_code, details_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(newId("quarantine"), runId, artifactId, reasonCode, JSON.stringify(details), now);
    }
    database.prepare("UPDATE source_artifact SET status = 'quarantined' WHERE id = ?").run(artifactId);
    database
      .prepare("UPDATE source_publication SET status = 'quarantined' WHERE id = (SELECT publication_id FROM source_artifact WHERE id = ?)")
      .run(artifactId);
    database.prepare("UPDATE ingest_run SET quarantined_count = 1 WHERE id = ?").run(runId);
  })();
}

function resolveRecoveredProcessingQuarantines(database: OperationalDatabase, runId: string): void {
  const artifact = database
    .prepare(
      `SELECT artifact.id, publication.source_publication_key
       FROM ingest_run run
       JOIN source_artifact artifact ON artifact.id = run.artifact_id
       JOIN source_publication publication ON publication.id = artifact.publication_id
       WHERE run.id = ?`,
    )
    .get(runId) as { id: string; source_publication_key: string } | undefined;
  if (!artifact) return;
  database
    .prepare(
      `UPDATE quarantine SET status = 'resolved', resolved_at = ?, resolution_note = ?
       WHERE status = 'open'
       AND reason_code IN ('PDF_OCR_REQUIRED', 'SOURCE_TEMPLATE_CHANGED', 'UNSUPPORTED_DOCUMENT', 'PDF_PARSE_FAILED')
       AND (artifact_id = ? OR json_extract(details_json, '$.publication.key') = ?)`,
    )
    .run(
      new Date().toISOString(),
      `Resolved by successful PDF-processing run ${runId}`,
      artifact.id,
      artifact.source_publication_key,
    );
}

function updateProcessingCounts(database: OperationalDatabase, runId: string): void {
  const run = database.prepare("SELECT artifact_id FROM ingest_run WHERE id = ?").get(runId) as { artifact_id: string | null };
  const artifactId = run.artifact_id;
  const extracted = artifactId ? count(database, "SELECT COUNT(*) AS count FROM extracted_text_item WHERE artifact_id = ?", artifactId) : 0;
  const parsed = artifactId ? count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", artifactId) : 0;
  const quarantined = artifactId
    ? count(database, "SELECT COUNT(*) AS count FROM quarantine WHERE artifact_id = ? AND status = 'open'", artifactId)
    : 0;
  database
    .prepare("UPDATE ingest_run SET fetched_count = ?, extracted_count = ?, parsed_count = ?, quarantined_count = ? WHERE id = ?")
    .run(artifactId ? 1 : 0, extracted, parsed, quarantined, runId);
}

function invalidateProcessingOutputs(database: OperationalDatabase, artifactId: string | null, stage: ProcessingStage): void {
  if (!artifactId) return;
  database.transaction(() => {
    if (["retrieve_pdf", "parse_pdf"].includes(stage)) {
      database.prepare("DELETE FROM extracted_text_item WHERE artifact_id = ?").run(artifactId);
      retireStagingRows(database, artifactId);
      database
        .prepare(
          `UPDATE source_artifact SET inspection_json = NULL, parser_strategy = NULL,
           parser_confidence = NULL, parser_diagnostics_json = NULL, status = 'fetched' WHERE id = ?`,
        )
        .run(artifactId);
      database.prepare("DELETE FROM artifact_quality_assessment WHERE artifact_id = ?").run(artifactId);
    } else if (stage === "extract_data") {
      retireStagingRows(database, artifactId);
      database
        .prepare(
          `UPDATE source_artifact SET parser_strategy = NULL, parser_confidence = NULL,
           parser_diagnostics_json = NULL, status = 'processed' WHERE id = ?`,
        )
        .run(artifactId);
      database.prepare("DELETE FROM artifact_quality_assessment WHERE artifact_id = ?").run(artifactId);
    } else if (stage === "validate_data") {
      database.prepare("UPDATE staging_observation SET status = 'pending_validation' WHERE artifact_id = ?").run(artifactId);
      database.prepare("UPDATE source_artifact SET status = 'processed' WHERE id = ?").run(artifactId);
      database.prepare("DELETE FROM artifact_quality_assessment WHERE artifact_id = ?").run(artifactId);
    } else if (stage === "assess_completeness") {
      database.prepare("DELETE FROM artifact_quality_assessment WHERE artifact_id = ?").run(artifactId);
    }
  })();
}

function retireStagingRows(database: OperationalDatabase, artifactId: string): void {
  database.prepare("UPDATE staging_observation SET status = 'stale' WHERE artifact_id = ?").run(artifactId);
  database
    .prepare(
      `DELETE FROM staging_observation WHERE artifact_id = ? AND status = 'stale'
       AND NOT EXISTS (
         SELECT 1 FROM price_observation observation
         WHERE observation.staging_id = staging_observation.id
       )`,
    )
    .run(artifactId);
}

function blockStages(database: OperationalDatabase, runId: string, workflow: readonly StageName[], failedStage: StageName): void {
  const index = workflow.indexOf(failedStage);
  for (const stage of workflow.slice(index + 1)) {
    blockStage(database, runId, stage, `${stageLabel(stage)} is blocked until ${stageLabel(failedStage)} succeeds`, [failedStage]);
  }
}

function missingProcessingInputs(database: OperationalDatabase, artifactId: string | null, stage: ProcessingStage): string[] {
  if (stage === "retrieve_pdf") return [];
  if (!artifactId) return ["retrieved PDF"];
  if (stage === "extract_data" && !count(database, "SELECT COUNT(*) AS count FROM extracted_text_item WHERE artifact_id = ?", artifactId)) {
    return ["parsed PDF text"];
  }
  if (stage === "validate_data" && !count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ?", artifactId)) {
    return ["structured records"];
  }
  if (stage === "insert_data") {
    const total = count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", artifactId);
    const validated = count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status = 'validated'", artifactId);
    if (!total || total !== validated) return ["validated records"];
  }
  if (stage === "assess_completeness" && !count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", artifactId)) {
    return ["inserted staging records"];
  }
  if (
    stage === "canonicalize_data" &&
    !count(database, "SELECT COUNT(*) AS count FROM artifact_quality_assessment WHERE artifact_id = ?", artifactId)
  ) {
    return ["completeness assessment"];
  }
  return [];
}

function sourceSyncInput(
  manifest: SourceManifest,
  stage: SourceSyncStage,
  options: IngestionOptions,
  context: SourceSyncContext,
): Record<string, unknown> {
  if (stage === "check_source") return { source_url: manifest.landing_url, from: options.from ?? null, to: options.to ?? null };
  if (stage === "compare_inventory") return { discovered: context.publications.length };
  if (stage === "download_new_pdfs") return { new_pdfs: context.pending.length };
  if (stage === "upload_to_r2") return { downloaded: context.downloaded.size };
  return { uploaded: context.uploaded.size, reconcile: context.reconcile.length };
}

function sourceSyncInputCount(stage: SourceSyncStage, context: SourceSyncContext): number {
  if (stage === "check_source") return 1;
  if (stage === "compare_inventory") return context.publications.length;
  if (stage === "download_new_pdfs") return context.pending.length;
  if (stage === "upload_to_r2") return context.downloaded.size;
  return context.uploaded.size + context.reconcile.length;
}

function processingInput(database: OperationalDatabase, context: ProcessingContext, stage: ProcessingStage): Record<string, unknown> {
  if (stage === "retrieve_pdf") return { archive_id: context.archiveId };
  if (stage === "parse_pdf") return { artifact_id: context.artifactId, dependency: "retrieve_pdf" };
  if (stage === "extract_data") return { artifact_id: context.artifactId, dependency: "parse_pdf" };
  const records = context.artifactId
    ? count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", context.artifactId)
    : 0;
  return { artifact_id: context.artifactId, dependency: processingDependencies[stage][0], records };
}

function processingInputCount(database: OperationalDatabase, context: ProcessingContext, stage: ProcessingStage): number {
  if (stage === "retrieve_pdf" || stage === "parse_pdf") return 1;
  if (!context.artifactId) return 0;
  if (stage === "extract_data") return count(database, "SELECT COUNT(*) AS count FROM extracted_text_item WHERE artifact_id = ?", context.artifactId);
  return count(database, "SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND status != 'stale'", context.artifactId);
}

type ArchivedPdf = {
  id: string;
  publication_id: string;
  publication_key: string;
  title: string;
  source_url: string;
  r2_bucket: string;
  r2_key: string;
  r2_uri: string;
  sha256: string | null;
};

function archivedPdf(database: OperationalDatabase, archiveId: string): ArchivedPdf | undefined {
  return database
    .prepare(
      `SELECT archive.id, archive.publication_id, publication.source_publication_key AS publication_key,
       publication.title, archive.source_url, archive.r2_bucket, archive.r2_key, archive.r2_uri, archive.sha256
       FROM archived_pdf archive JOIN source_publication publication ON publication.id = archive.publication_id
       WHERE archive.id = ?`,
    )
    .get(archiveId) as ArchivedPdf | undefined;
}

function extractedItems(database: OperationalDatabase, artifactId: string): TextItem[] {
  return database
    .prepare(
      `SELECT page_number AS page, item_index AS "index", text, x, y, width, height
       FROM extracted_text_item WHERE artifact_id = ? ORDER BY page_number, item_index`,
    )
    .all(artifactId) as TextItem[];
}

function recordRunPublications(database: OperationalDatabase, runId: string, publications: Publication[]): void {
  database.transaction(() => {
    database.prepare("DELETE FROM run_publication WHERE run_id = ?").run(runId);
    const insert = database.prepare("INSERT INTO run_publication (run_id, publication_id, ordinal) VALUES (?, ?, ?)");
    publications.forEach((publication, index) => insert.run(runId, `publication_${publication.key}`, index));
  })();
}

function recordPublications(database: OperationalDatabase, sourceId: string, publications: Publication[]): void {
  const statement = database.prepare(
    `INSERT INTO source_publication (
      id, source_id, source_publication_key, title, published_at, observed_from, observed_to,
      landing_url, download_url, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, source_publication_key) DO UPDATE SET
      title = excluded.title, published_at = excluded.published_at, download_url = excluded.download_url,
      last_seen_at = excluded.last_seen_at`,
  );
  const now = new Date().toISOString();
  database.transaction(() => {
    for (const publication of publications) {
      statement.run(
        `publication_${publication.key}`,
        sourceId,
        publication.key,
        publication.title,
        `${publication.date}T00:00:00.000Z`,
        publication.date,
        publication.date,
        publication.landingUrl,
        publication.downloadUrl,
        now,
        now,
      );
    }
  })();
}

function legacySnapshotStages(database: OperationalDatabase, runId: string): readonly StageName[] {
  const rows = database.prepare("SELECT stage FROM run_stage WHERE run_id = ? ORDER BY id").all(runId) as Array<{ stage: StageName }>;
  if (rows.some((row) => row.stage === "crawl")) return legacyStages;
  return rows.map((row) => row.stage);
}

function stageStatus(database: OperationalDatabase, runId: string, stage: StageName): string | null {
  return (database.prepare("SELECT status FROM run_stage WHERE run_id = ? AND stage = ?").get(runId, stage) as { status: string } | undefined)?.status ?? null;
}

function requiredArtifact(context: ProcessingContext): string {
  if (!context.artifactId) throw new Error("RETRIEVED_PDF_INPUT_MISSING");
  return context.artifactId;
}

function archiveKey(publication: Publication): string {
  return hartiArchiveObjectKey(publication);
}

function archiveUri(storage: ArchiveStorage, key: string): string {
  return storage.uri?.(key) ?? `r2://${storage.bucket}/${key}`;
}

function isPdf(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === "%PDF-";
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function count(database: OperationalDatabase, sql: string, ...values: unknown[]): number {
  return (database.prepare(sql).get(...values) as { count: number }).count;
}

function stageLabel(stage: StageName): string {
  const labels: Partial<Record<StageName, string>> = {
    check_source: "Check official source",
    compare_inventory: "Compare PDF inventory",
    download_new_pdfs: "Download new PDFs",
    upload_to_r2: "Upload PDFs to R2",
    record_pdf_metadata: "Record PDF metadata",
    retrieve_pdf: "Retrieve PDF",
    parse_pdf: "Parse PDF",
    extract_data: "Extract structured data",
    validate_data: "Validate extracted data",
    insert_data: "Insert validated data",
    assess_completeness: "Assess document completeness",
    canonicalize_data: "Promote canonical observations",
  };
  return labels[stage] ?? stage.replaceAll("_", " ");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function requestWithRetry(request: typeof fetch, url: string, attempts: number, intervalMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(url, {
        headers: { "user-agent": "LankaPriceLens/0.1 (+self-hosted data foundry)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) throw new Error(`SOURCE_HTTP_${response.status}`);
      lastError = new Error(`SOURCE_HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /^SOURCE_HTTP_4(?!29)/u.test(error.message)) throw error;
    }
    if (attempt < attempts) await delay(intervalMs);
  }
  throw lastError instanceof Error ? lastError : new Error("SOURCE_FETCH_FAILED");
}

async function limitedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new Error("SOURCE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel();
      throw new Error("SOURCE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
