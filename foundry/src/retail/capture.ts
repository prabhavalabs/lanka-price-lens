import { createHash } from "node:crypto";

import { canCaptureSource, type MappingBundle, type SourceManifest } from "@lanka-pricelens/shared";

import type { ArchiveStorage } from "../archive-storage.ts";
import { finalizeProcessedArtifacts, persistProcessedArtifact } from "../artifact.ts";
import { finishRun, heartbeatRun, logStage, newId, startRun, syncSource, type OperationalDatabase } from "../db.ts";
import { canonicalizeArtifact, type CanonicalizeOptions } from "../mapping.ts";
import { executeLoggedStage, retailCaptureStages, type WorkflowExecutionOptions } from "../pipeline.ts";
import { assessArtifactCompleteness } from "../quality.ts";
import { resolveAdapterSettings, SettingsError, type BaseSettings } from "./settings.ts";
import { nodeHttpsFetch } from "./http.ts";
import type { FetchLike, NormalizedRecord, RetailAdapter, SnapshotPayload } from "./types.ts";

export type RetailCaptureOptions = {
  trigger: string;
  http?: FetchLike | undefined;
  archive?: ArchiveStorage | undefined;
  mappingBundle?: MappingBundle | undefined;
  execution?: WorkflowExecutionOptions | undefined;
  now?: Date | undefined;
  /** Trading day the snapshot is filed under; defaults to today in Asia/Colombo. */
  captureDate?: string | undefined;
  userAgent?: string | undefined;
  /**
   * Records captured elsewhere (another machine, an exported snapshot) to file
   * instead of fetching from the retailer. Validation, storage, dedupe, and
   * promotion run exactly as for a live capture; only the fetch is skipped.
   */
  snapshot?: { records: NormalizedRecord[]; payload?: SnapshotPayload | undefined } | undefined;
};

export type RetailCaptureStatus = "succeeded" | "failed" | "blocked" | "skipped";

export type RetailCaptureResult = {
  runId: string | null;
  status: RetailCaptureStatus;
  code: string | null;
  message: string | null;
  records: number;
  unchanged: boolean;
  artifactId: string | null;
};

type CaptureContext = {
  date: string;
  payload: SnapshotPayload | null;
  records: NormalizedRecord[];
  artifactId: string | null;
  unchanged: boolean;
};

const DEFAULT_USER_AGENT = "LankaPriceLens/1.0 (+https://lankapricelens.com; price transparency research)";
/** Failure codes that mean the snapshot itself is suspect and needs a human look, not a retry. */
const REVIEW_CODES = new Set(["SNAPSHOT_TOO_SMALL", "SNAPSHOT_VOLUME_ANOMALY", "SNAPSHOT_EMPTY"]);

/**
 * Runs one retail capture for a source: fetch through its adapter, normalise to
 * the unified record shape, validate, store the snapshot as evidence plus staging
 * rows, then promote to canonical observations through the source's mapping bundle.
 *
 * Fault tolerance: one run per source at a time (run lease), bounded retries with
 * backoff inside the adapter, content-hash dedupe so a re-capture of identical prices
 * is a no-op, volume guards that hold a suspicious snapshot for review instead of
 * publishing it, and a circuit breaker that pauses a source after repeated failures.
 */
export async function runRetailCapture<S extends BaseSettings>(
  database: OperationalDatabase,
  manifest: SourceManifest,
  adapter: RetailAdapter<S>,
  options: RetailCaptureOptions,
): Promise<RetailCaptureResult> {
  syncSource(database, manifest);
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const health = readHealth(database, manifest.id);
  if (health.paused_until && health.paused_until > nowIso) {
    return skipped(null, "CAPTURE_PAUSED", `Source paused until ${health.paused_until} after ${health.consecutive_failures} consecutive failures`);
  }

  const run = startRun(database, {
    sourceId: manifest.id,
    trigger: options.trigger,
    workflow: "retail_capture",
    leaseMinutes: 30,
    ...(options.execution
      ? {
          definitionKey: options.execution.definitionKey,
          definitionVersion: options.execution.definitionVersion,
          dispatchId: options.execution.dispatchId,
          scheduledFor: options.execution.scheduledFor,
          environment: options.execution.environment,
        }
      : {}),
  });
  if (!run.started) return skipped(run.id, "RUN_ALREADY_ACTIVE", "Another run for this source is still active");

  if (!canCaptureSource(manifest, now)) {
    finishRun(database, run.id, "blocked", { code: "RIGHTS_BLOCKED", message: "Source rights review is not current" });
    return { runId: run.id, status: "blocked", code: "RIGHTS_BLOCKED", message: "Source rights review is not current", records: 0, unchanged: false, artifactId: null };
  }

  const context: CaptureContext = { date: options.captureDate ?? colomboDay(now), payload: null, records: [], artifactId: null, unchanged: false };
  const http = options.http ?? (adapter.transport === "node_https" ? nodeHttpsFetch : fetch);
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const stages = retailCaptureStages;

  try {
    const settings = resolveAdapterSettings(database, manifest, adapter);

    const imported = options.snapshot;
    await executeLoggedStage(database, run.id, "fetch_snapshot", 0, { adapter: adapter.kind, capture_date: context.date, imported: Boolean(imported) }, async () => {
      const payload = imported
        ? imported.payload ?? { fetchedAt: nowIso, requests: 0, data: { imported: true, records: imported.records.length } }
        : await adapter.fetch(settings, {
            http,
            now,
            userAgent,
            log: (level, message, data) => logStage(database, run.id, "fetch_snapshot", level, message, data),
          });
      context.payload = payload;
      return { outputCount: payload.requests, output: { requests: payload.requests, fetched_at: payload.fetchedAt, imported: Boolean(imported) } };
    }, stages);
    heartbeatRun(database, run.id);

    await executeLoggedStage(database, run.id, "normalize_records", context.payload?.requests ?? 0, {}, () => {
      if (!context.payload) throw new Error("SNAPSHOT_EMPTY");
      context.records = imported ? imported.records.map((record) => ({ ...record, date: context.date })) : adapter.normalize(context.payload, settings, context.date);
      return { outputCount: context.records.length, output: { records: context.records.length } };
    }, stages);

    await executeLoggedStage(database, run.id, "validate_records", context.records.length, {}, () => {
      const outcome = validateRecords(database, manifest.id, settings, context);
      return { outputCount: outcome.kept, warningCount: outcome.dropped, output: outcome };
    }, stages);
    heartbeatRun(database, run.id);

    await executeLoggedStage(database, run.id, "store_snapshot", context.records.length, {}, async () => {
      return storeSnapshot(database, run.id, manifest, adapter, settings, context, options.archive, nowIso);
    }, stages);

    await executeLoggedStage(database, run.id, "canonicalize_data", context.records.length, { artifact_id: context.artifactId }, () => {
      return canonicalize(database, run.id, adapter, context, options.mappingBundle);
    }, stages);

    markHealthy(database, manifest.id, nowIso);
    finishRun(database, run.id, "succeeded");
    return { runId: run.id, status: "succeeded", code: null, message: null, records: context.records.length, unchanged: context.unchanged, artifactId: context.artifactId };
  } catch (error) {
    const message = errorMessage(error);
    const code = failureCode(error);
    const review = REVIEW_CODES.has(code);
    if (review) recordReviewHold(database, run.id, context, code, message);
    finishRun(database, run.id, review ? "blocked" : "failed", { code, message });
    // A bad setting is an operator mistake, not a source outage; it must not trip the breaker.
    if (!(error instanceof SettingsError)) recordFailure(database, manifest.id, code, message, health.consecutive_failures + 1, now, maxFailures(database, manifest, adapter));
    return { runId: run.id, status: review ? "blocked" : "failed", code, message, records: context.records.length, unchanged: false, artifactId: context.artifactId };
  }
}

function validateRecords(
  database: OperationalDatabase,
  sourceId: string,
  settings: BaseSettings,
  context: CaptureContext,
): { kept: number; dropped: number; previous_count: number | null; change_pct: number | null; rejected_samples: string[] } {
  const rejected: string[] = [];
  const kept: NormalizedRecord[] = [];
  for (const record of context.records) {
    const reason = recordProblem(record, context.date);
    if (reason) {
      if (rejected.length < 10) rejected.push(`${record.rowRef}: ${reason}`);
      continue;
    }
    kept.push(record);
  }
  if (kept.length === 0) throw new Error("SNAPSHOT_EMPTY");
  if (kept.length < settings.minimumRecords) throw new Error(`SNAPSHOT_TOO_SMALL:${kept.length} records, minimum ${settings.minimumRecords}`);

  const previous = previousSnapshotCount(database, sourceId, context.date);
  const changePct = previous && previous > 0 ? Math.round((Math.abs(kept.length - previous) / previous) * 1000) / 10 : null;
  if (changePct !== null && changePct > settings.maxRecordCountChangePct) {
    throw new Error(`SNAPSHOT_VOLUME_ANOMALY:${kept.length} records vs ${previous} in the previous snapshot (${changePct}% change)`);
  }
  context.records = kept.sort((left, right) => left.rowRef.localeCompare(right.rowRef));
  return { kept: kept.length, dropped: rejected.length, previous_count: previous, change_pct: changePct, rejected_samples: rejected };
}

function recordProblem(record: NormalizedRecord, date: string): string | null {
  if (!record.rowRef.trim()) return "missing row reference";
  if (!record.itemLabel.trim()) return "missing item label";
  if (!record.marketLabel.trim()) return "missing market label";
  if (record.date !== date) return `date ${record.date} outside capture day`;
  if (!Number.isInteger(record.minValueMinor) || record.minValueMinor <= 0) return "non-positive price";
  if (!Number.isInteger(record.maxValueMinor) || record.maxValueMinor < record.minValueMinor) return "max below min";
  if (record.minValueMinor > 10_000_000 * 100) return "price above LKR 10,000,000";
  const quantity = Number(record.sourceQuantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return `invalid quantity ${record.sourceQuantity}`;
  if (!record.sourceUnit.trim()) return "missing unit";
  return null;
}

function previousSnapshotCount(database: OperationalDatabase, sourceId: string, beforeDate: string): number | null {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM staging_observation observation
       WHERE observation.artifact_id = (
         SELECT artifact.id FROM source_artifact artifact
         JOIN source_publication publication ON publication.id = artifact.publication_id
         WHERE publication.source_id = ? AND publication.source_publication_key < ?
           AND artifact.status IN ('parsed', 'canonicalized')
         ORDER BY publication.source_publication_key DESC, artifact.fetched_at DESC LIMIT 1
       ) AND observation.status != 'stale'`,
    )
    .get(sourceId, snapshotKey(beforeDate)) as { count: number } | undefined;
  return row && row.count > 0 ? row.count : null;
}

async function storeSnapshot<S extends BaseSettings>(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  adapter: RetailAdapter<S>,
  settings: S,
  context: CaptureContext,
  archive: ArchiveStorage | undefined,
  nowIso: string,
): Promise<{ outputCount: number; warningCount?: number; output: Record<string, unknown> }> {
  const records = context.records;
  const contentHash = sha256(JSON.stringify(records.map(({ raw: _raw, ...record }) => record)));
  const publicationId = ensurePublication(database, manifest, context.date, nowIso);

  const existing = database
    .prepare("SELECT id, status FROM source_artifact WHERE publication_id = ? AND sha256 = ?")
    .get(publicationId, contentHash) as { id: string; status: string } | undefined;
  if (existing) {
    context.artifactId = existing.id;
    context.unchanged = true;
    database.prepare("UPDATE ingest_run SET artifact_id = ?, fetched_count = 1, parsed_count = 0 WHERE id = ?").run(existing.id, runId);
    logStage(database, runId, "store_snapshot", "info", "Snapshot identical to an earlier capture today; nothing new to store", { artifact_id: existing.id });
    return { outputCount: 0, output: { artifact_id: existing.id, unchanged: true, records: records.length } };
  }

  const evidence = {
    source_id: manifest.id,
    adapter: adapter.kind,
    capture_date: context.date,
    captured_at: nowIso,
    content_sha256: contentHash,
    settings,
    records,
    payload: context.payload,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(evidence));
  const fileName = `${manifest.id}-${context.date}-${contentHash.slice(0, 12)}.json`;
  const key = `sources/${manifest.id}/snapshots/${context.date.slice(0, 4)}/${context.date.slice(5, 7)}/${fileName}`;
  let storageRef: string | null = null;
  if (archive) {
    await archive.upload(key, fileName, bytes, { "source-date": context.date, sha256: contentHash, adapter: adapter.kind });
    storageRef = archive.uri?.(key) ?? `r2://${archive.bucket}/${key}`;
  }

  const artifactId = newId("artifact");
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO source_artifact (
          id, publication_id, run_id, requested_url, final_url, fetched_at, media_type,
          byte_size, sha256, storage_ref, original_filename, status
        ) VALUES (?, ?, ?, ?, ?, ?, 'application/json', ?, ?, ?, ?, 'fetched')`,
      )
      .run(artifactId, publicationId, runId, snapshotUrl(manifest.id, context.date), snapshotUrl(manifest.id, context.date), nowIso, bytes.byteLength, contentHash, storageRef, fileName);
    database.prepare("INSERT OR IGNORE INTO run_publication (run_id, publication_id, ordinal) VALUES (?, ?, 0)").run(runId, publicationId);
    // An earlier snapshot for the same day with different prices is superseded by this one.
    database
      .prepare(
        `UPDATE staging_observation SET status = 'stale'
         WHERE artifact_id IN (SELECT id FROM source_artifact WHERE publication_id = ? AND id != ?) AND status != 'stale'`,
      )
      .run(publicationId, artifactId);
    persistProcessedArtifact(database, { artifactId, runId, items: [], observations: records, priceType: adapter.priceType });
    database.prepare("UPDATE staging_observation SET status = 'validated' WHERE artifact_id = ? AND status = 'pending_validation'").run(artifactId);
    finalizeProcessedArtifacts(database, runId, [artifactId]);
    database.prepare("UPDATE ingest_run SET artifact_id = ?, fetched_count = 1, parsed_count = ? WHERE id = ?").run(artifactId, records.length, runId);
  })();

  context.artifactId = artifactId;
  return {
    outputCount: records.length,
    output: { artifact_id: artifactId, publication_id: publicationId, sha256: contentHash, byte_size: bytes.byteLength, storage_ref: storageRef, records: records.length },
  };
}

function canonicalize<S>(
  database: OperationalDatabase,
  runId: string,
  adapter: RetailAdapter<S>,
  context: CaptureContext,
  bundle: MappingBundle | undefined,
): { outputCount: number; warningCount?: number; output: Record<string, unknown> } {
  if (!context.artifactId) throw new Error("ARTIFACT_MISSING");
  // An identical re-capture still promotes rows once a newer bundle can map them; otherwise there is nothing to do.
  if (context.unchanged && !(bundle && pendingCanonicalization(database, context.artifactId, bundle))) {
    return { outputCount: 0, output: { artifact_id: context.artifactId, status: "unchanged" } };
  }
  const assessment = assessArtifactCompleteness(database, runId, context.artifactId, bundle);
  if (!bundle) {
    return {
      outputCount: 0,
      warningCount: 1,
      output: { artifact_id: context.artifactId, status: "not_configured", message: "No mapping bundle for this source; records stay in staging" },
    };
  }
  const result = canonicalizeArtifact(database, runId, context.artifactId, bundle, retailParserVersion(adapter), retailCanonicalizeOptions);
  const canonicalized = result.accepted + result.corrected + result.historical;
  database.prepare("UPDATE source_artifact SET status = 'canonicalized', mapping_version = ? WHERE id = ?").run(bundle.mapping_version, context.artifactId);
  database
    .prepare("UPDATE source_publication SET status = 'canonicalized' WHERE id = (SELECT publication_id FROM source_artifact WHERE id = ?)")
    .run(context.artifactId);
  return {
    outputCount: canonicalized,
    warningCount: result.quarantined,
    output: {
      artifact_id: context.artifactId,
      status: "canonicalized",
      canonicalized,
      ...result,
      mapping_coverage: assessment.mappingCoverage,
      unknown_items: assessment.unknownItems.length,
      unknown_units: assessment.unknownUnits.length,
    },
  };
}

/**
 * Whole-catalogue snapshots carry thousands of deliberately unmapped labels (recorded,
 * not quarantined row by row) and several brands of one item, each keeping its own
 * daily price so the warehouse can show a store's range.
 */
export const retailCanonicalizeOptions: CanonicalizeOptions = { unknownLabels: "record", effectiveKeyScope: "label" };

export function retailParserVersion<S>(adapter: RetailAdapter<S>): string {
  return `retail-${adapter.kind}@1`;
}

/** True until the artifact has been promoted with the bundle version now in force, so a bundle change reaches snapshots already stored. */
export function pendingCanonicalization(database: OperationalDatabase, artifactId: string, bundle: MappingBundle): boolean {
  const artifact = database.prepare("SELECT mapping_version FROM source_artifact WHERE id = ?").get(artifactId) as { mapping_version: string | null } | undefined;
  return artifact?.mapping_version !== bundle.mapping_version;
}

function ensurePublication(database: OperationalDatabase, manifest: SourceManifest, date: string, nowIso: string): string {
  const key = snapshotKey(date);
  const existing = database
    .prepare("SELECT id FROM source_publication WHERE source_id = ? AND source_publication_key = ?")
    .get(manifest.id, key) as { id: string } | undefined;
  if (existing) {
    database.prepare("UPDATE source_publication SET last_seen_at = ? WHERE id = ?").run(nowIso, existing.id);
    return existing.id;
  }
  const id = `publication_${manifest.id}_${key}`;
  database
    .prepare(
      `INSERT INTO source_publication (
        id, source_id, source_publication_key, title, published_at, observed_from, observed_to,
        landing_url, download_url, status, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'discovered', ?, ?)`,
    )
    .run(id, manifest.id, key, `${manifest.name} snapshot ${date}`, `${date}T00:00:00.000Z`, date, date, manifest.landing_url, snapshotUrl(manifest.id, date), nowIso, nowIso);
  return id;
}

function recordReviewHold(database: OperationalDatabase, runId: string, context: CaptureContext, code: string, message: string): void {
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO quarantine (id, run_id, artifact_id, reason_code, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(newId("quarantine"), runId, context.artifactId, code, JSON.stringify({ message, records: context.records.length, capture_date: context.date }), now);
    database.prepare("UPDATE ingest_run SET quarantined_count = 1 WHERE id = ?").run(runId);
  })();
}

type Health = { consecutive_failures: number; paused_until: string | null };

function readHealth(database: OperationalDatabase, sourceId: string): Health {
  const row = database.prepare("SELECT consecutive_failures, paused_until FROM source WHERE id = ?").get(sourceId) as Health | undefined;
  return row ?? { consecutive_failures: 0, paused_until: null };
}

function markHealthy(database: OperationalDatabase, sourceId: string, nowIso: string): void {
  database
    .prepare(
      `UPDATE source SET consecutive_failures = 0, paused_until = NULL, last_capture_error = NULL, last_capture_at = ?,
       last_fetch_at = ?, last_parse_at = ?, state = 'healthy', updated_at = ? WHERE id = ?`,
    )
    .run(nowIso, nowIso, nowIso, nowIso, sourceId);
}

/**
 * Circuit breaker: after `maxFailures` consecutive failures the source is paused,
 * doubling from six hours (6h, 12h, 24h, capped at 48h) so a broken retailer does
 * not burn requests every day while still recovering on its own.
 */
function recordFailure(database: OperationalDatabase, sourceId: string, code: string, message: string, failures: number, now: Date, maxFailures: number): void {
  const pausedUntil = failures >= maxFailures ? new Date(now.getTime() + pauseHours(failures - maxFailures) * 3_600_000).toISOString() : null;
  database
    .prepare(
      `UPDATE source SET consecutive_failures = ?, paused_until = ?, last_capture_error = ?, state = ?, updated_at = ? WHERE id = ?`,
    )
    .run(failures, pausedUntil, `${code}: ${message}`.slice(0, 500), pausedUntil ? "paused" : "degraded", now.toISOString(), sourceId);
}

export function pauseHours(escalation: number): number {
  return Math.min(48, 6 * 2 ** Math.max(0, escalation));
}

function maxFailures<S extends BaseSettings>(database: OperationalDatabase, manifest: SourceManifest, adapter: RetailAdapter<S>): number {
  try {
    return resolveAdapterSettings(database, manifest, adapter).maxConsecutiveFailures;
  } catch {
    return 3;
  }
}

/** Clears a pause and failure streak so the next scheduled capture runs. */
export function resumeSourceCapture(database: OperationalDatabase, sourceId: string, actor: string): void {
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare("UPDATE source SET consecutive_failures = 0, paused_until = NULL, state = CASE WHEN state = 'paused' THEN 'degraded' ELSE state END, updated_at = ? WHERE id = ?")
      .run(now, sourceId);
    database
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'capture.resumed', 'source', ?, '{}', ?)`,
      )
      .run(newId("audit"), actor, sourceId, now);
  })();
}

function failureCode(error: unknown): string {
  if (error instanceof SettingsError) return "SETTINGS_INVALID";
  const message = errorMessage(error);
  const head = message.split(":", 1)[0] ?? message;
  if (/^[A-Z][A-Z0-9_]+$/u.test(head)) return head;
  if (error instanceof Error && error.name === "TimeoutError") return "SOURCE_TIMEOUT";
  return "CAPTURE_FAILED";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function skipped(runId: string | null, code: string, message: string): RetailCaptureResult {
  return { runId, status: "skipped", code, message, records: 0, unchanged: false, artifactId: null };
}

function snapshotKey(date: string): string {
  return `snapshot_${date}`;
}

function snapshotUrl(sourceId: string, date: string): string {
  return `snapshot://${sourceId}/${date}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Calendar day in Sri Lanka, so a capture just after midnight UTC still files under the right trading day. */
export function colomboDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Colombo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
