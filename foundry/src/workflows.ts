import { hostname } from "node:os";

import { CronExpressionParser } from "cron-parser";

import { sourceKind, type MappingBundle, type RetryPolicy, type SourceManifest, type StageName, type WorkflowName } from "@lanka-pricelens/shared";

import { configuredArchiveStorage } from "./archive-storage.ts";
import { newId, syncSource, type OperationalDatabase } from "./db.ts";
import { singleSourceCatalog, type SourceCatalog } from "./manifest.ts";
import { processingStages, retailCaptureStages, runPdfProcessing, runSourceSync, sourceSyncStages } from "./pipeline.ts";
import { retailAdapterFor } from "./retail/index.ts";
import { runRetailCapture } from "./retail/capture.ts";
import { failureCodeOf, retryableFailure } from "./retry.ts";

export const workflowDefinitionVersion = 3;
export const workflowDefinitions = [
  {
    key: "latest_document_collection",
    title: "Latest Document Collection",
    description: "Checks the official source for newly published price documents and archives only missing PDFs.",
    executor: "source_sync",
    trigger: "scheduled",
    schedule: "15 * * * *",
    scheduleLabel: "Hourly at :15",
    timezone: "Asia/Colombo",
    maxItems: 5,
    steps: sourceSyncStages,
  },
  {
    key: "historical_backfill",
    title: "Historical Backfill",
    description: "Compares source history with local metadata and fills a bounded set of missing records.",
    executor: "source_sync",
    trigger: "backfill",
    schedule: "15 0 * * *",
    scheduleLabel: "Daily at 00:15",
    timezone: "Asia/Colombo",
    maxItems: 25,
    steps: sourceSyncStages,
  },
  {
    key: "document_processing_pipeline",
    title: "Document Processing Pipeline",
    description: "Retrieves, parses, validates, scores, and promotes every archived pricing document into canonical observations.",
    executor: "pdf_processing",
    trigger: "scheduled",
    schedule: "*/5 * * * *",
    scheduleLabel: "Event driven · recovery every 5 minutes",
    timezone: "Asia/Colombo",
    maxItems: 10,
    steps: processingStages,
  },
  {
    key: "retail_price_capture",
    title: "Retail Price Capture",
    description: "Captures shelf prices from each configured supermarket adapter once a day, stores the snapshot as evidence, and promotes mapped items into canonical observations.",
    executor: "retail_capture",
    trigger: "scheduled",
    schedule: "30 6 * * *",
    scheduleLabel: "Daily at 06:30",
    timezone: "Asia/Colombo",
    maxItems: 1,
    steps: retailCaptureStages,
  },
] as const satisfies readonly WorkflowDefinition[];

export type WorkflowKey = (typeof workflowDefinitions)[number]["key"];
export type DispatchStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";
export type WorkflowDefinition = {
  key: string;
  title: string;
  description: string;
  executor: WorkflowName;
  trigger: "scheduled" | "backfill";
  schedule: string;
  scheduleLabel: string;
  timezone: string;
  maxItems: number;
  steps: readonly StageName[];
};
export type WorkflowDispatch = {
  id: string;
  schedule_id: string | null;
  workflow_key: WorkflowKey;
  source_id: string;
  archive_id: string | null;
  trigger: "scheduled" | "manual" | "backfill" | "recovery";
  status: DispatchStatus;
  scheduled_for: string;
  available_at: string;
  claimed_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  run_id: string | null;
  requested_by: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  /** Which attempt of a retried dispatch this is (1 for a first attempt) and the dispatch it retries. */
  attempt: number;
  retry_of: string | null;
};

/**
 * Queues the next attempt of a failed dispatch after the policy's cooldown, or returns null when the
 * attempts are spent. The new dispatch keeps the workflow, source, document, trigger, and schedule slot
 * of the failed one, so the history reads as one job tried several times.
 */
export function scheduleRetryDispatch(database: OperationalDatabase, dispatch: WorkflowDispatch, policy: RetryPolicy, now = new Date()): WorkflowDispatch | null {
  const attempt = (dispatch.attempt ?? 1) + 1;
  if (attempt > policy.attempts) return null;
  const id = newId("dispatch");
  const availableAt = new Date(now.getTime() + Math.max(0, policy.cooldown_minutes) * 60_000).toISOString();
  const inserted = database
    .prepare(
      `INSERT OR IGNORE INTO workflow_dispatch (
        id, schedule_id, workflow_key, source_id, archive_id, trigger, status, scheduled_for,
        available_at, requested_by, idempotency_key, created_at, attempt, retry_of
      ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id, dispatch.schedule_id, dispatch.workflow_key, dispatch.source_id, dispatch.archive_id, dispatch.trigger, dispatch.scheduled_for,
      availableAt, dispatch.requested_by, `retry:${dispatch.retry_of ?? dispatch.id}:${attempt}`, now.toISOString(), attempt, dispatch.id,
    );
  return inserted.changes ? (database.prepare("SELECT * FROM workflow_dispatch WHERE id = ?").get(id) as WorkflowDispatch) : null;
}

export function workflowDefinition(key: string): (typeof workflowDefinitions)[number] | undefined {
  return workflowDefinitions.find((definition) => definition.key === key);
}

/** Retail sources run only the capture workflow; PDF bulletin sources run the document workflows. */
export function applicableWorkflowDefinitions(manifest: Pick<SourceManifest, "adapter">): Array<(typeof workflowDefinitions)[number]> {
  const retail = sourceKind(manifest) === "retail_snapshot";
  return workflowDefinitions.filter((definition) => (definition.executor === "retail_capture") === retail);
}

export function ensureWorkflowSchedules(database: OperationalDatabase, manifest: SourceManifest, now = new Date()): void {
  syncSource(database, manifest);
  const enabled = process.env.LPL_SCHEDULER_ENABLED === "false" ? 0 : 1;
  const nowIso = now.toISOString();
  const statement = database.prepare(
    `INSERT INTO workflow_schedule (
      id, workflow_key, source_id, cron_expression, timezone, enabled, max_items,
      next_run_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workflow_key, source_id) DO UPDATE SET
      cron_expression = excluded.cron_expression,
      timezone = excluded.timezone,
      max_items = excluded.max_items,
      updated_at = excluded.updated_at`,
  );
  for (const definition of applicableWorkflowDefinitions(manifest)) {
    statement.run(
      `schedule_${definition.key}_${manifest.id}`,
      definition.key,
      manifest.id,
      definition.schedule,
      definition.timezone,
      enabled,
      definition.maxItems,
      nextOccurrence(definition.schedule, definition.timezone, now).toISOString(),
      nowIso,
      nowIso,
    );
  }
}

export function enqueueDueSchedules(database: OperationalDatabase, now = new Date()): number {
  const nowIso = now.toISOString();
  return database.transaction(() => {
    const schedules = database
      .prepare(
        `SELECT id, workflow_key, source_id, cron_expression, timezone, max_items, next_run_at
         FROM workflow_schedule WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at`,
      )
      .all(nowIso) as Array<{
        id: string;
        workflow_key: WorkflowKey;
        source_id: string;
        cron_expression: string;
        timezone: string;
        max_items: number | null;
        next_run_at: string;
      }>;
    let inserted = 0;
    for (const schedule of schedules) {
      const definition = workflowDefinition(schedule.workflow_key);
      if (!definition) continue;
      const dispatchId = newId("dispatch");
      const result = database
        .prepare(
          `INSERT OR IGNORE INTO workflow_dispatch (
            id, schedule_id, workflow_key, source_id, trigger, status, scheduled_for,
            available_at, idempotency_key, created_at
          ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
        )
        .run(
          dispatchId,
          schedule.id,
          schedule.workflow_key,
          schedule.source_id,
          definition.key === "historical_backfill" ? "backfill" : "scheduled",
          schedule.next_run_at,
          nowIso,
          `schedule:${schedule.id}:${schedule.next_run_at}`,
          nowIso,
        );
      inserted += result.changes;
      const next = nextOccurrence(schedule.cron_expression, schedule.timezone, now).toISOString();
      database
        .prepare(
          `UPDATE workflow_schedule SET next_run_at = ?, last_due_at = ?,
           last_dispatch_id = CASE WHEN ? = 1 THEN ? ELSE last_dispatch_id END, updated_at = ? WHERE id = ?`,
        )
        .run(next, schedule.next_run_at, result.changes, dispatchId, nowIso, schedule.id);
    }
    return inserted;
  })();
}

export function enqueueWorkflow(
  database: OperationalDatabase,
  options: { workflowKey: WorkflowKey; sourceId: string; archiveId?: string; requestedBy: string; now?: Date },
): WorkflowDispatch {
  const definition = workflowDefinition(options.workflowKey);
  if (!definition) throw new Error("WORKFLOW_NOT_FOUND");
  if (definition.executor === "pdf_processing" && !options.archiveId) throw new Error("ARCHIVE_REQUIRED");
  if (options.archiveId) {
    const archive = database
      .prepare(
        `SELECT archive.id FROM archived_pdf archive
         JOIN source_publication publication ON publication.id = archive.publication_id
         WHERE archive.id = ? AND publication.source_id = ?`,
      )
      .get(options.archiveId, options.sourceId);
    if (!archive) throw new Error("ARCHIVE_NOT_FOUND");
  }
  const now = options.now ?? new Date();
  const id = newId("dispatch");
  database
    .prepare(
      `INSERT INTO workflow_dispatch (
        id, workflow_key, source_id, archive_id, trigger, status, scheduled_for,
        available_at, requested_by, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, 'manual', 'queued', ?, ?, ?, ?, ?)`,
    )
    .run(id, options.workflowKey, options.sourceId, options.archiveId ?? null, now.toISOString(), now.toISOString(), options.requestedBy, `manual:${id}`, now.toISOString());
  return database.prepare("SELECT * FROM workflow_dispatch WHERE id = ?").get(id) as WorkflowDispatch;
}

export function claimNextDispatch(database: OperationalDatabase, instanceId: string, now = new Date()): WorkflowDispatch | null {
  const nowIso = now.toISOString();
  return database.transaction(() => {
    const next = database
      .prepare(
        `SELECT id FROM workflow_dispatch
         WHERE status = 'queued' AND available_at <= ? ORDER BY scheduled_for, created_at LIMIT 1`,
      )
      .get(nowIso) as { id: string } | undefined;
    if (!next) return null;
    const claimed = database
      .prepare(
        `UPDATE workflow_dispatch SET status = 'running', claimed_by = ?, claimed_at = ?, started_at = ?
         WHERE id = ? AND status = 'queued'`,
      )
      .run(instanceId, nowIso, nowIso, next.id);
    return claimed.changes
      ? database.prepare("SELECT * FROM workflow_dispatch WHERE id = ?").get(next.id) as WorkflowDispatch
      : null;
  })();
}

export function recoverInterruptedDispatches(database: OperationalDatabase, now = new Date()): number {
  const cutoff = new Date(now.getTime() - 60 * 60_000).toISOString();
  const stale = database
    .prepare("SELECT id FROM workflow_dispatch WHERE status = 'running' AND claimed_at < ?")
    .all(cutoff) as Array<{ id: string }>;
  let recovered = 0;
  const transaction = database.transaction(() => {
    for (const dispatch of stale) {
      const run = database
        .prepare(
          `SELECT id, status, finished_at, lease_expires_at, error_code, error_message FROM ingest_run
           WHERE dispatch_id = ? AND parent_run_id IS NULL ORDER BY started_at DESC LIMIT 1`,
        )
        .get(dispatch.id) as {
          id: string;
          status: "running" | "succeeded" | "failed" | "blocked" | "skipped";
          finished_at: string | null;
          lease_expires_at: string;
          error_code: string | null;
          error_message: string | null;
        } | undefined;
      if (run?.status === "running" && run.lease_expires_at >= now.toISOString()) continue;
      if (run && run.status !== "running") {
        database
          .prepare(
            `UPDATE workflow_dispatch SET status = ?, run_id = ?, finished_at = ?,
             error_code = ?, error_message = ? WHERE id = ? AND status = 'running'`,
          )
          .run(run.status === "blocked" ? "failed" : run.status, run.id, run.finished_at ?? now.toISOString(), run.error_code, run.error_message, dispatch.id);
      } else {
        database
          .prepare(
            `UPDATE workflow_dispatch SET status = 'queued', available_at = ?, claimed_by = NULL,
             claimed_at = NULL, started_at = NULL WHERE id = ? AND status = 'running'`,
          )
          .run(now.toISOString(), dispatch.id);
      }
      recovered += 1;
    }
  });
  transaction();
  return recovered;
}

export async function executeDispatch(
  database: OperationalDatabase,
  manifest: SourceManifest,
  dispatch: WorkflowDispatch,
  environment = process.env.LPL_ENVIRONMENT ?? "local",
  mappingBundle?: MappingBundle,
): Promise<void> {
  const definition = workflowDefinition(dispatch.workflow_key);
  if (!definition) return failDispatch(database, dispatch.id, "WORKFLOW_NOT_FOUND", `Unknown workflow ${dispatch.workflow_key}`);
  const execution = {
    definitionKey: definition.key,
    definitionVersion: workflowDefinitionVersion,
    dispatchId: dispatch.id,
    scheduledFor: dispatch.scheduled_for,
    environment,
  };
  try {
    const archive = await configuredArchiveStorage();
    if (definition.key === "document_processing_pipeline" && !dispatch.archive_id) {
      const queued = enqueueProcessingRecovery(database, dispatch.source_id, definition.maxItems, dispatch.scheduled_for, archiveUriPrefix(archive));
      finishDispatch(database, dispatch.id, "succeeded", null, queued ? `${queued} document workflows queued` : null);
      return;
    }
    if (definition.executor === "retail_capture") {
      const adapter = retailAdapterFor(manifest);
      if (!adapter) return failDispatch(database, dispatch.id, "ADAPTER_NOT_CONFIGURED", `Source ${manifest.id} has no retail adapter`);
      const capture = await runRetailCapture(database, manifest, adapter, {
        trigger: dispatch.trigger === "manual" ? "manual" : "scheduled",
        archive,
        execution,
        mappingBundle,
      });
      linkRetriedRun(database, dispatch, capture.runId);
      if (capture.status === "succeeded") return finishDispatch(database, dispatch.id, "succeeded", capture.runId, capture.unchanged ? "Prices unchanged since the previous snapshot" : null);
      if (capture.status === "skipped") return finishDispatch(database, dispatch.id, "skipped", capture.runId, capture.message);
      return failDispatchWithRetry(database, manifest, dispatch, capture.code ?? "CAPTURE_FAILED", capture.message ?? "Capture failed", capture.runId, capture.status);
    }
    const result = definition.executor === "pdf_processing"
      ? await runPdfProcessing(database, manifest, requiredArchive(dispatch), {
          trigger: dispatch.trigger === "manual" ? "manual" : "scheduled",
          archive,
          execution,
          mappingBundle,
        })
      : await runSourceSync(database, manifest, {
          trigger: definition.key === "historical_backfill" ? "backfill" : dispatch.trigger === "manual" ? "manual" : "scheduled",
          archive,
          limit: definition.maxItems,
          execution,
          mappingBundle,
        });
    linkRetriedRun(database, dispatch, result.runId);
    if (result.status === "failed") return failDispatchWithRetry(database, manifest, dispatch, "PDF_PROCESSING_FAILED", "Document processing failed", result.runId, "failed");
    finishDispatch(database, dispatch.id, result.status === "blocked" ? "failed" : result.status, result.runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A source sync marks its run failed and throws; the run this dispatch opened is the source's newest one.
    const run = database
      .prepare("SELECT id FROM ingest_run WHERE dispatch_id = ? ORDER BY started_at DESC LIMIT 1")
      .get(dispatch.id) as { id: string } | undefined;
    linkRetriedRun(database, dispatch, run?.id ?? null);
    failDispatchWithRetry(database, manifest, dispatch, failureCodeOf(error) ?? "WORKFLOW_EXECUTION_FAILED", message, run?.id ?? null, "failed");
  }
}

/** Fails the dispatch and, when the failure is one a retry can help with and attempts remain, queues the next attempt after the cooldown. */
function failDispatchWithRetry(database: OperationalDatabase, manifest: SourceManifest, dispatch: WorkflowDispatch, code: string, message: string, runId: string | null, status: string): void {
  const retry = retryableFailure({ status, code }) ? scheduleRetryDispatch(database, dispatch, manifest.retry) : null;
  const note = retry
    ? `${message} (attempt ${dispatch.attempt ?? 1} of ${manifest.retry.attempts}; retrying at ${retry.available_at})`
    : (dispatch.attempt ?? 1) > 1
      ? `${message} (attempt ${dispatch.attempt} of ${manifest.retry.attempts}; attempts exhausted)`
      : message;
  failDispatch(database, dispatch.id, code, note, runId);
}

/** Marks the run a retried dispatch opened with its attempt number and the run it retries. */
function linkRetriedRun(database: OperationalDatabase, dispatch: WorkflowDispatch, runId: string | null): void {
  if (!runId || (dispatch.attempt ?? 1) <= 1 || !dispatch.retry_of) return;
  const previous = database.prepare("SELECT run_id FROM workflow_dispatch WHERE id = ?").get(dispatch.retry_of) as { run_id: string | null } | undefined;
  database.prepare("UPDATE ingest_run SET attempt = ?, retry_of = ? WHERE id = ?").run(dispatch.attempt, previous?.run_id ?? null, runId);
}

export function schedulerHeartbeat(
  database: OperationalDatabase,
  instanceId: string,
  options: { status?: "online" | "stopping"; error?: string | null; now?: Date } = {},
): void {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  database
    .prepare(
      `INSERT INTO scheduler_instance (id, environment, status, started_at, heartbeat_at, last_tick_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, heartbeat_at = excluded.heartbeat_at,
       last_tick_at = excluded.last_tick_at, last_error = excluded.last_error, updated_at = excluded.updated_at`,
    )
    .run(
      instanceId,
      process.env.LPL_ENVIRONMENT ?? "local",
      options.status ?? "online",
      nowIso,
      nowIso,
      nowIso,
      options.error ?? null,
      nowIso,
    );
}

export async function schedulerTick(
  database: OperationalDatabase,
  sources: SourceCatalog | SourceManifest,
  instanceId = `${hostname()}:${process.pid}`,
  now = new Date(),
  mappingBundle?: MappingBundle,
): Promise<{ enqueued: number; executed: number }> {
  const catalog = "entries" in sources ? sources : singleSourceCatalog(sources, mappingBundle);
  for (const entry of catalog.entries) ensureWorkflowSchedules(database, entry.manifest, now);
  recoverInterruptedDispatches(database, now);
  const enqueued = enqueueDueSchedules(database, now);
  schedulerHeartbeat(database, instanceId, { now });
  let executed = 0;
  for (;;) {
    const dispatch = claimNextDispatch(database, instanceId);
    if (!dispatch) break;
    const entry = catalog.find(dispatch.source_id);
    if (!entry) {
      failDispatch(database, dispatch.id, "SOURCE_NOT_CONFIGURED", `No manifest loaded for source ${dispatch.source_id}`);
    } else {
      await executeDispatch(database, entry.manifest, dispatch, process.env.LPL_ENVIRONMENT ?? "local", entry.mappingBundle);
    }
    executed += 1;
  }
  schedulerHeartbeat(database, instanceId);
  return { enqueued, executed };
}

/** The URI prefix (for example `r2://bucket/` or `file:///root/`) that the configured storage can actually read. */
export function archiveUriPrefix(storage: { uri?: ((key: string) => string) | undefined }): string | null {
  const probe = storage.uri?.("probe");
  return probe?.endsWith("probe") ? probe.slice(0, -"probe".length) : null;
}

export function enqueueProcessingRecovery(database: OperationalDatabase, sourceId: string, limit: number, scheduledFor: string, uriPrefix: string | null = null): number {
  const archives = database
    .prepare(
      `SELECT archive.id
       FROM archived_pdf archive
       JOIN source_publication publication ON publication.id = archive.publication_id
       WHERE publication.source_id = ?
         AND (
           NOT EXISTS (
             SELECT 1 FROM ingest_run run
             WHERE run.archive_id = archive.id AND run.workflow = 'pdf_processing' AND run.status = 'succeeded'
           )
           -- A run that finished without a mapping bundle parsed rows but published nothing;
           -- pick it up again so the prices land once the bundle is configured.
           OR EXISTS (
             SELECT 1 FROM source_artifact artifact
             JOIN artifact_quality_assessment quality ON quality.artifact_id = artifact.id
             WHERE artifact.publication_id = publication.id AND quality.status = 'not_configured'
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM workflow_dispatch queued
           WHERE queued.archive_id = archive.id AND queued.workflow_key = 'document_processing_pipeline'
             AND queued.status IN ('queued', 'running')
         )
         -- Archives already swept once keep their idempotency key, so re-selecting them would only
         -- burn the LIMIT and starve newer documents.
         AND NOT EXISTS (
           SELECT 1 FROM workflow_dispatch prior
           WHERE prior.idempotency_key = 'processing:' || archive.id || ':v' || ?
         )
         -- Only documents the configured archive driver can read; a local filesystem run must not
         -- burn its slots on PDFs that live in R2 (and vice versa).
         AND (? IS NULL OR substr(archive.r2_uri, 1, length(?)) = ?)
       ORDER BY COALESCE(archive.uploaded_at, archive.created_at) LIMIT ?`,
    )
    .all(sourceId, String(workflowDefinitionVersion), uriPrefix, uriPrefix ?? "", uriPrefix ?? "", limit) as Array<{ id: string }>;
  const now = new Date().toISOString();
  const statement = database.prepare(
    `INSERT OR IGNORE INTO workflow_dispatch (
      id, workflow_key, source_id, archive_id, trigger, status, scheduled_for,
      available_at, idempotency_key, created_at
    ) VALUES (?, 'document_processing_pipeline', ?, ?, 'recovery', 'queued', ?, ?, ?, ?)`,
  );
  let inserted = 0;
  for (const archive of archives) {
    inserted += statement.run(newId("dispatch"), sourceId, archive.id, scheduledFor, now, `processing:${archive.id}:v${workflowDefinitionVersion}`, now).changes;
  }
  return inserted;
}

function finishDispatch(database: OperationalDatabase, id: string, status: DispatchStatus, runId: string | null, note: string | null = null): void {
  database
    .prepare(
      `UPDATE workflow_dispatch SET status = ?, run_id = ?, finished_at = ?, error_message = ? WHERE id = ?`,
    )
    .run(status, runId, new Date().toISOString(), note, id);
}

function failDispatch(database: OperationalDatabase, id: string, code: string, message: string, runId: string | null = null): void {
  database
    .prepare(
      `UPDATE workflow_dispatch SET status = 'failed', error_code = ?, error_message = ?, finished_at = ?, run_id = COALESCE(?, run_id) WHERE id = ?`,
    )
    .run(code, message, new Date().toISOString(), runId, id);
}

function requiredArchive(dispatch: WorkflowDispatch): string {
  if (!dispatch.archive_id) throw new Error("ARCHIVE_REQUIRED");
  return dispatch.archive_id;
}

function nextOccurrence(expression: string, timezone: string, currentDate: Date): Date {
  return CronExpressionParser.parse(expression, { currentDate, tz: timezone }).next().toDate();
}
