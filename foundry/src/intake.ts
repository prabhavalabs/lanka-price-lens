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
import { parseHartiWholesale } from "./harti.ts";
import { inspectPdf, type PdfInspection } from "./pdf.ts";

export const maximumPdfBytes = 20 * 1024 * 1024;

export type ManualIntakeResult = {
  runId: string | null;
  artifactId: string;
  status: "parsed" | "quarantined" | "duplicate";
  parsedCount: number;
  inspection: PdfInspection | null;
  reason: string | null;
};

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
    const observations = parseHartiWholesale(extraction.items);
    persistParsedArtifact(database, { artifactId, runId: run.id, items: extraction.items, observations });
    finishStage(database, run.id, "parse", "succeeded", { outputCount: observations.length });
    skipDownstreamStages(database, run.id);
    database
      .prepare(
        `UPDATE ingest_run SET fetched_count = 1, extracted_count = ?, parsed_count = ? WHERE id = ?`,
      )
      .run(extraction.items.length, observations.length, run.id);
    database
      .prepare("UPDATE source SET last_fetch_at = ?, last_parse_at = ?, updated_at = ? WHERE id = ?")
      .run(now, new Date().toISOString(), new Date().toISOString(), manifest.id);
    finishRun(database, run.id, "succeeded");
    return {
      runId: run.id,
      artifactId,
      status: "parsed",
      parsedCount: observations.length,
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
      message.startsWith("SOURCE_TEMPLATE_CHANGED") ? "SOURCE_TEMPLATE_CHANGED" : "PDF_PARSE_FAILED",
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
      .run(newId("quarantine"), runId, artifactId, reasonCode, JSON.stringify({ message, inspection }), now);
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
