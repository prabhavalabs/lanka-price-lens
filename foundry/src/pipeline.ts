import { createHash } from "node:crypto";

import { canPublishSource, type SourceManifest } from "@lanka-pricelens/shared";

import {
  finishRun,
  finishStage,
  heartbeatRun,
  newId,
  startRun,
  startStage,
  syncSource,
  type OperationalDatabase,
} from "./db.ts";
import { persistParsedArtifact } from "./artifact.ts";
import { discoverHartiDaily, parseHartiWholesale, type Publication } from "./harti.ts";
import { inspectPdf } from "./pdf.ts";

export type IngestionOptions = {
  trigger: "scheduled" | "manual" | "backfill";
  from?: string | undefined;
  to?: string | undefined;
  request?: typeof fetch | undefined;
  inspector?: typeof inspectPdf | undefined;
};

export async function runIngestion(
  database: OperationalDatabase,
  manifest: SourceManifest,
  options: IngestionOptions,
): Promise<{ runId: string; status: "succeeded" | "blocked" | "skipped" }> {
  syncSource(database, manifest);
  const run = startRun(database, { sourceId: manifest.id, trigger: options.trigger, from: options.from, to: options.to });
  if (!run.started) return { runId: run.id, status: "skipped" };

  startStage(database, run.id, "rights");
  if (!canPublishSource(manifest)) {
    const message = "Source is disabled, unapproved, or its rights review has expired";
    finishStage(database, run.id, "rights", "blocked", { errorCode: "SOURCE_RIGHTS_BLOCKED", errorMessage: message });
    finishRun(database, run.id, "blocked", { code: "SOURCE_RIGHTS_BLOCKED", message });
    database.prepare("UPDATE source SET state = 'blocked', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifest.id);
    return { runId: run.id, status: "blocked" };
  }
  finishStage(database, run.id, "rights", "succeeded");

  const request = options.request ?? fetch;
  let quarantined = 0;
  try {
    startStage(database, run.id, "discover");
    const landing = await requestWithRetry(request, manifest.landing_url, manifest.max_attempts, manifest.request_interval_ms);
    const html = new TextDecoder().decode(await limitedBody(landing, 5 * 1024 * 1024));
    const publications = discoverHartiDaily(html, manifest.landing_url, { from: options.from, to: options.to });
    recordPublications(database, manifest.id, publications);
    const parsedKeys = new Set(
      (
        database
          .prepare(
            `SELECT publication.source_publication_key AS key
             FROM source_publication publication
             JOIN source_artifact artifact ON artifact.publication_id = publication.id
             WHERE publication.source_id = ? AND artifact.status = 'parsed'`,
          )
          .all(manifest.id) as Array<{ key: string }>
      ).map((row) => row.key),
    );
    let pending = publications.filter((publication) => !parsedKeys.has(publication.key));
    if (options.trigger === "scheduled" && !options.from && !options.to) {
      const newestCompletedIndex = publications.findIndex((publication) => parsedKeys.has(publication.key));
      pending = newestCompletedIndex < 0 ? pending.slice(0, 1) : publications.slice(0, newestCompletedIndex);
    }
    finishStage(database, run.id, "discover", "succeeded", { outputCount: publications.length });
    database.prepare("UPDATE ingest_run SET discovered_count = ? WHERE id = ?").run(publications.length, run.id);
    database.prepare("UPDATE source SET last_discovery_at = ?, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      new Date().toISOString(),
      manifest.id,
    );

    for (const stage of ["fetch", "extract", "parse"] as const) startStage(database, run.id, stage, pending.length);

    for (const [index, publication] of pending.entries()) {
      heartbeatRun(database, run.id);
      try {
        if (index > 0) await new Promise<void>((resolve) => setTimeout(resolve, manifest.request_interval_ms));
        await processPublication(database, run.id, manifest, publication, request, options.inspector ?? inspectPdf);
      } catch (error) {
        quarantined += 1;
        const message = error instanceof Error ? error.message : String(error);
        database
          .prepare(
            `INSERT INTO quarantine (id, run_id, reason_code, source_row_ref, details_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId("quarantine"),
            run.id,
            message.startsWith("SOURCE_TEMPLATE_CHANGED")
              ? "SOURCE_TEMPLATE_CHANGED"
              : message.startsWith("PDF_OCR_REQUIRED")
                ? "PDF_OCR_REQUIRED"
                : "PUBLICATION_PROCESSING_FAILED",
            publication.key,
            JSON.stringify({ publication, message }),
            new Date().toISOString(),
          );
      }
      const progress = runProgress(database, run.id);
      database
        .prepare(
          `UPDATE ingest_run SET fetched_count = ?, extracted_count = ?, parsed_count = ?,
           quarantined_count = ? WHERE id = ?`,
        )
        .run(progress.fetched, progress.extracted, progress.parsed, quarantined, run.id);
    }

    const progress = runProgress(database, run.id);
    finishStage(database, run.id, "fetch", "succeeded", { outputCount: progress.fetched, warningCount: quarantined });
    finishStage(database, run.id, "extract", "succeeded", { outputCount: progress.extracted, warningCount: quarantined });
    finishStage(database, run.id, "parse", "succeeded", { outputCount: progress.parsed, warningCount: quarantined });
    for (const stage of ["map", "validate", "release"] as const) {
      startStage(database, run.id, stage);
      finishStage(database, run.id, stage, "skipped");
    }

    database
      .prepare(
        `UPDATE ingest_run SET discovered_count = ?, fetched_count = ?, extracted_count = ?,
         parsed_count = ?, quarantined_count = ? WHERE id = ?`,
      )
      .run(publications.length, progress.fetched, progress.extracted, progress.parsed, quarantined, run.id);
    database
      .prepare(
        `UPDATE source SET state = ?, last_fetch_at = COALESCE(?, last_fetch_at),
         last_parse_at = COALESCE(?, last_parse_at), updated_at = ? WHERE id = ?`,
      )
      .run(
        quarantined ? "degraded" : "healthy",
        progress.fetched ? new Date().toISOString() : null,
        progress.parsed ? new Date().toISOString() : null,
        new Date().toISOString(),
        manifest.id,
      );
    finishRun(database, run.id, "succeeded");
    return { runId: run.id, status: "succeeded" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    database
      .prepare(
        `UPDATE run_stage SET status = 'failed', finished_at = ?, error_code = 'INGESTION_FAILED', error_message = ?
         WHERE run_id = ? AND status = 'running'`,
      )
      .run(new Date().toISOString(), message, run.id);
    finishRun(database, run.id, "failed", { code: "INGESTION_FAILED", message });
    database.prepare("UPDATE source SET state = 'degraded', updated_at = ? WHERE id = ?").run(new Date().toISOString(), manifest.id);
    throw error;
  }
}

async function processPublication(
  database: OperationalDatabase,
  runId: string,
  manifest: SourceManifest,
  publication: Publication,
  request: typeof fetch,
  inspector: typeof inspectPdf,
): Promise<void> {
  const publicationId = `publication_${publication.key}`;
  const done = database
    .prepare("SELECT 1 FROM source_artifact WHERE publication_id = ? AND status = 'parsed' LIMIT 1")
    .get(publicationId);
  if (done) return;

  const response = await requestWithRetry(request, publication.downloadUrl, manifest.max_attempts, manifest.request_interval_ms);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "application/octet-stream";
  if (contentType !== "application/pdf" && contentType !== "application/octet-stream") throw new Error("SOURCE_MEDIA_TYPE_INVALID");
  const bytes = await limitedBody(response, 20 * 1024 * 1024);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifactId = `artifact_${publication.key}_${sha256.slice(0, 12)}`;
  database
    .prepare(
      `INSERT INTO source_artifact (
        id, publication_id, run_id, requested_url, final_url, fetched_at, media_type, byte_size,
        sha256, storage_ref, http_etag, http_last_modified, original_filename, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'fetched')
      ON CONFLICT(publication_id, sha256) DO UPDATE SET
        run_id = excluded.run_id, fetched_at = excluded.fetched_at, status = 'fetched'`,
    )
    .run(
      artifactId,
      publicationId,
      runId,
      publication.downloadUrl,
      response.url || publication.downloadUrl,
      new Date().toISOString(),
      contentType,
      bytes.byteLength,
      sha256,
      response.headers.get("etag"),
      response.headers.get("last-modified"),
      publication.title,
    );

  const stored = database.prepare("SELECT id FROM source_artifact WHERE publication_id = ? AND sha256 = ?").get(publicationId, sha256) as { id: string };
  let extraction;
  let observations;
  try {
    extraction = await inspector(bytes);
    database.prepare("UPDATE source_artifact SET inspection_json = ? WHERE id = ?").run(
      JSON.stringify(extraction.inspection),
      stored.id,
    );
    if (extraction.inspection.pagesNeedingOcr.length) {
      throw new Error(`PDF_OCR_REQUIRED: pages ${extraction.inspection.pagesNeedingOcr.join(",")}`);
    }
    observations = parseHartiWholesale(extraction.items);
  } catch (error) {
    database.prepare("UPDATE source_artifact SET status = 'quarantined' WHERE id = ?").run(stored.id);
    throw error;
  }
  persistParsedArtifact(database, { artifactId: stored.id, runId, items: extraction.items, observations });
}

function runProgress(database: OperationalDatabase, runId: string): { fetched: number; extracted: number; parsed: number } {
  return database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM source_artifact WHERE run_id = ?) AS fetched,
        (SELECT COUNT(*) FROM extracted_text_item item JOIN source_artifact artifact ON artifact.id = item.artifact_id WHERE artifact.run_id = ?) AS extracted,
        (SELECT COUNT(*) FROM staging_observation WHERE run_id = ?) AS parsed`,
    )
    .get(runId, runId, runId) as { fetched: number; extracted: number; parsed: number };
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
  const transaction = database.transaction(() => {
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
  });
  transaction();
}

async function requestWithRetry(request: typeof fetch, url: string, attempts: number, intervalMs: number): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await request(url, { headers: { "user-agent": "LankaPriceLens/0.1 (+self-hosted data foundry)" }, signal: AbortSignal.timeout(30_000) });
      if (response.ok) return response;
      if (response.status < 500 && response.status !== 429) throw new Error(`SOURCE_HTTP_${response.status}`);
      lastError = new Error(`SOURCE_HTTP_${response.status}`);
    } catch (error) {
      lastError = error;
      if (error instanceof Error && /^SOURCE_HTTP_4(?!29)/u.test(error.message)) throw error;
    }
    if (attempt < attempts) await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
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
