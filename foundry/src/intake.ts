import { createHash } from "node:crypto";

import type { SourceManifest } from "@lanka-pricelens/shared";

import { persistParsedArtifact } from "./artifact.ts";
import {
  finishRun,
  finishStage,
  newId,
  startRun,
  startStage,
  syncSource,
  type OperationalDatabase,
} from "./db.ts";
import { HartiParseError, parseHartiWholesaleWithDiagnostics } from "./harti.ts";
import { inspectPdf, type PdfInspection } from "./pdf.ts";
import type { ArchiveStorage } from "./archive-storage.ts";

export const maximumPdfBytes = 20 * 1024 * 1024;

export type ManualIntakeResult = {
  runId: string | null;
  artifactId: string;
  status: "parsed" | "quarantined" | "duplicate";
  parsedCount: number;
  inspection: PdfInspection | null;
  reason: string | null;
};

export async function archiveManualArtifact(
  database: OperationalDatabase,
  manifest: SourceManifest,
  input: { artifactId: string; fileName: string; bytes: Uint8Array; actor: string; archive: ArchiveStorage },
): Promise<string> {
  const artifact = database
    .prepare("SELECT publication_id, sha256 FROM source_artifact WHERE id = ?")
    .get(input.artifactId) as { publication_id: string; sha256: string } | undefined;
  if (!artifact) throw new Error("ARTIFACT_NOT_FOUND");
  const existing = database.prepare("SELECT id FROM archived_pdf WHERE publication_id = ?").get(artifact.publication_id) as { id: string } | undefined;
  if (existing) return existing.id;
  const key = `sources/${manifest.id}/manual/${artifact.sha256}.pdf`;
  await input.archive.upload(key, input.fileName, input.bytes, {
    "source-url": `manual-upload://${artifact.sha256}`,
    sha256: artifact.sha256,
  });
  const archiveId = `archive_manual_${artifact.sha256.slice(0, 24)}`;
  const now = new Date().toISOString();
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO archived_pdf (
          id, publication_id, source_url, r2_bucket, r2_key, r2_uri, byte_size,
          sha256, uploaded_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?)`,
      )
      .run(
        archiveId,
        artifact.publication_id,
        `manual-upload://${artifact.sha256}`,
        input.archive.bucket,
        key,
        input.archive.uri?.(key) ?? `r2://${input.archive.bucket}/${key}`,
        input.bytes.byteLength,
        artifact.sha256,
        now,
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'manual_pdf_archived', 'archived_pdf', ?, ?, ?)`,
      )
      .run(newId("audit"), input.actor, archiveId, JSON.stringify({ artifact_id: input.artifactId, storage_key: key }), now);
  })();
  return archiveId;
}

export async function ingestManualPdf(
  database: OperationalDatabase,
  manifest: SourceManifest,
  input: {
    fileName: string;
    bytes: Uint8Array;
    actor: string;
    inspector?: typeof inspectPdf;
  },
): Promise<ManualIntakeResult> {
  if (!input.bytes.byteLength) throw new Error("UPLOAD_EMPTY");
  if (input.bytes.byteLength > maximumPdfBytes) throw new Error("UPLOAD_TOO_LARGE");
  if (manifest.rights_status === "blocked") throw new Error("SOURCE_RIGHTS_BLOCKED");

  syncSource(database, manifest);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const duplicate = database
    .prepare(
      `SELECT artifact.id, artifact.run_id, artifact.inspection_json
       FROM source_artifact artifact
       JOIN source_publication publication ON publication.id = artifact.publication_id
       WHERE publication.source_id = ? AND artifact.sha256 = ?
       ORDER BY artifact.fetched_at DESC LIMIT 1`,
    )
    .get(manifest.id, sha256) as
    | { id: string; run_id: string | null; inspection_json: string | null }
    | undefined;
  if (duplicate) {
    return {
      runId: duplicate.run_id,
      artifactId: duplicate.id,
      status: "duplicate",
      parsedCount: 0,
      inspection: duplicate.inspection_json ? (JSON.parse(duplicate.inspection_json) as PdfInspection) : null,
      reason: null,
    };
  }

  const run = startRun(database, { sourceId: manifest.id, trigger: "manual" });
  if (!run.started) throw new Error("SOURCE_BUSY");

  const now = new Date().toISOString();
  const key = `manual_${sha256.slice(0, 24)}`;
  const publicationId = `publication_${key}`;
  const artifactId = `artifact_${key}`;
  startStage(database, run.id, "rights");
  finishStage(database, run.id, "rights", "succeeded");
  startStage(database, run.id, "discover");
  finishStage(database, run.id, "discover", "skipped");
  startStage(database, run.id, "fetch", 1);

  try {
    database.transaction(() => {
      database
        .prepare(
          `INSERT INTO source_publication (
            id, source_id, source_publication_key, title, landing_url, download_url,
            status, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'discovered', ?, ?)`,
        )
        .run(publicationId, manifest.id, key, input.fileName, manifest.landing_url, `manual-upload://${key}`, now, now);
      database
        .prepare(
          `INSERT INTO source_artifact (
            id, publication_id, run_id, requested_url, final_url, fetched_at, media_type,
            byte_size, sha256, original_filename, status
          ) VALUES (?, ?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, 'fetched')`,
        )
        .run(
          artifactId,
          publicationId,
          run.id,
          `manual-upload://${key}`,
          `manual-upload://${key}`,
          now,
          input.bytes.byteLength,
          sha256,
          input.fileName,
        );
      database
        .prepare(
          `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
           VALUES (?, ?, 'manual_pdf_uploaded', 'source_artifact', ?, ?, ?)`,
        )
        .run(newId("audit"), input.actor, artifactId, JSON.stringify({ file_name: input.fileName, sha256 }), now);
    })();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishStage(database, run.id, "fetch", "failed", { errorCode: "UPLOAD_RECORD_FAILED", errorMessage: message });
    finishRun(database, run.id, "failed", { code: "UPLOAD_RECORD_FAILED", message });
    throw error;
  }
  finishStage(database, run.id, "fetch", "succeeded", { outputCount: 1 });

  startStage(database, run.id, "extract", 1);
  let extraction: Awaited<ReturnType<typeof inspectPdf>>;
  try {
    extraction = await (input.inspector ?? inspectPdf)(input.bytes);
    database.prepare("UPDATE source_artifact SET inspection_json = ? WHERE id = ?").run(
      JSON.stringify(extraction.inspection),
      artifactId,
    );
  } catch (error) {
    return quarantine(database, run.id, artifactId, null, 0, "PDF_INSPECTION_FAILED", error);
  }

  if (!extraction.items.length && extraction.inspection.pagesNeedingOcr.length) {
    return quarantine(
      database,
      run.id,
      artifactId,
      extraction.inspection,
      0,
      "PDF_OCR_REQUIRED",
      new Error(`Pages ${extraction.inspection.pagesNeedingOcr.join(", ")} require OCR`),
    );
  }
  finishStage(database, run.id, "extract", "succeeded", { outputCount: extraction.items.length });

  startStage(database, run.id, "parse", extraction.items.length);
  try {
    const parsed = parseHartiWholesaleWithDiagnostics(extraction.items);
    persistParsedArtifact(database, { artifactId, runId: run.id, items: extraction.items, observations: parsed.observations });
    database
      .prepare(
        `UPDATE source_artifact SET parser_strategy = ?, parser_confidence = ?, parser_diagnostics_json = ?
         WHERE id = ?`,
      )
      .run(parsed.diagnostics.strategy, parsed.diagnostics.confidence, JSON.stringify(parsed.diagnostics), artifactId);
    finishStage(database, run.id, "parse", "succeeded", {
      outputCount: parsed.observations.length,
      warningCount: parsed.diagnostics.warnings.length,
      output: {
        parser_strategy: parsed.diagnostics.strategy,
        parser_confidence: parsed.diagnostics.confidence,
        parser_page: parsed.diagnostics.page,
        parser_signals: parsed.diagnostics.signals,
        parser_warnings: parsed.diagnostics.warnings,
      },
    });
    skipDownstreamStages(database, run.id);
    database
      .prepare(
        `UPDATE ingest_run SET fetched_count = 1, extracted_count = ?, parsed_count = ? WHERE id = ?`,
      )
      .run(extraction.items.length, parsed.observations.length, run.id);
    database
      .prepare("UPDATE source SET last_fetch_at = ?, last_parse_at = ?, updated_at = ? WHERE id = ?")
      .run(now, new Date().toISOString(), new Date().toISOString(), manifest.id);
    finishRun(database, run.id, "succeeded");
    return {
      runId: run.id,
      artifactId,
      status: "parsed",
      parsedCount: parsed.observations.length,
      inspection: extraction.inspection,
      reason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return quarantine(
      database,
      run.id,
      artifactId,
      extraction.inspection,
      extraction.items.length,
      error instanceof HartiParseError ? error.code : message.startsWith("SOURCE_TEMPLATE_CHANGED") ? "SOURCE_TEMPLATE_CHANGED" : "PDF_PARSE_FAILED",
      error,
    );
  }
}

function quarantine(
  database: OperationalDatabase,
  runId: string,
  artifactId: string,
  inspection: PdfInspection | null,
  extractedCount: number,
  reasonCode: string,
  error: unknown,
): ManualIntakeResult {
  const message = error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("UPDATE source_artifact SET status = 'quarantined' WHERE id = ?").run(artifactId);
    database
      .prepare(
        `INSERT INTO quarantine (id, run_id, artifact_id, reason_code, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        newId("quarantine"),
        runId,
        artifactId,
        reasonCode,
        JSON.stringify({
          message,
          inspection,
          ...(error instanceof HartiParseError ? { rejected_candidates: error.rejectedCandidates } : {}),
        }),
        now,
      );
    database
      .prepare("UPDATE ingest_run SET fetched_count = 1, extracted_count = ?, quarantined_count = 1 WHERE id = ?")
      .run(extractedCount, runId);
  })();
  database
    .prepare(
      `UPDATE run_stage SET status = 'blocked', finished_at = ?, warning_count = 1,
       error_code = ?, error_message = ? WHERE run_id = ? AND status = 'running'`,
    )
    .run(now, reasonCode, message, runId);
  const parseStage = database.prepare("SELECT 1 FROM run_stage WHERE run_id = ? AND stage = 'parse'").get(runId);
  if (!parseStage) {
    startStage(database, runId, "parse");
    finishStage(database, runId, "parse", "skipped");
  }
  skipDownstreamStages(database, runId);
  finishRun(database, runId, "succeeded");
  return { runId, artifactId, status: "quarantined", parsedCount: 0, inspection, reason: reasonCode };
}

function skipDownstreamStages(database: OperationalDatabase, runId: string): void {
  for (const stage of ["map", "validate", "release"] as const) {
    startStage(database, runId, stage);
    finishStage(database, runId, stage, "skipped");
  }
}
