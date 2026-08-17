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
import { discoverHartiDaily, parseHartiWholesale, type Publication } from "./harti.ts";
import { extractPdfText } from "./pdf.ts";

type IngestionOptions = {
  trigger: "scheduled" | "manual" | "backfill";
  from?: string | undefined;
  to?: string | undefined;
  request?: typeof fetch | undefined;
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
    let publications = discoverHartiDaily(html, manifest.landing_url, { from: options.from, to: options.to });
    if (options.trigger === "scheduled" && !options.from && !options.to) publications = publications.slice(0, 1);
    recordPublications(database, manifest.id, publications);
    finishStage(database, run.id, "discover", "succeeded", { outputCount: publications.length });
    database.prepare("UPDATE source SET last_discovery_at = ?, updated_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      new Date().toISOString(),
      manifest.id,
    );

    for (const stage of ["fetch", "extract", "parse"] as const) startStage(database, run.id, stage, publications.length);
    let fetched = 0;
    let extracted = 0;
    let parsed = 0;

    for (const [index, publication] of publications.entries()) {
      heartbeatRun(database, run.id);
      try {
        if (index > 0) await new Promise<void>((resolve) => setTimeout(resolve, manifest.request_interval_ms));
        const result = await processPublication(database, run.id, manifest, publication, request);
        fetched += result.fetched;
        extracted += result.extracted;
        parsed += result.parsed;
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
            message.startsWith("SOURCE_TEMPLATE_CHANGED") ? "SOURCE_TEMPLATE_CHANGED" : "PUBLICATION_PROCESSING_FAILED",
            publication.key,
            JSON.stringify({ publication, message }),
            new Date().toISOString(),
          );
      }
    }

    finishStage(database, run.id, "fetch", "succeeded", { outputCount: fetched, warningCount: quarantined });
    finishStage(database, run.id, "extract", "succeeded", { outputCount: extracted, warningCount: quarantined });
    finishStage(database, run.id, "parse", "succeeded", { outputCount: parsed, warningCount: quarantined });
    for (const stage of ["map", "validate", "release"] as const) {
      startStage(database, run.id, stage);
      finishStage(database, run.id, stage, "skipped");
    }

    database
      .prepare(
        `UPDATE ingest_run SET discovered_count = ?, fetched_count = ?, extracted_count = ?,
         parsed_count = ?, quarantined_count = ? WHERE id = ?`,
      )
      .run(publications.length, fetched, extracted, parsed, quarantined, run.id);
    database
      .prepare("UPDATE source SET state = ?, last_fetch_at = ?, last_parse_at = ?, updated_at = ? WHERE id = ?")
      .run(quarantined ? "degraded" : "healthy", fetched ? new Date().toISOString() : null, parsed ? new Date().toISOString() : null, new Date().toISOString(), manifest.id);
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
): Promise<{ fetched: number; extracted: number; parsed: number }> {
  const publicationId = `publication_${publication.key}`;
  const done = database
    .prepare("SELECT 1 FROM source_artifact WHERE publication_id = ? AND status = 'parsed' LIMIT 1")
    .get(publicationId);
  if (done) return { fetched: 0, extracted: 0, parsed: 0 };

  const response = await requestWithRetry(request, publication.downloadUrl, manifest.max_attempts, manifest.request_interval_ms);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "application/octet-stream";
  if (contentType !== "application/pdf" && contentType !== "application/octet-stream") throw new Error("SOURCE_MEDIA_TYPE_INVALID");
  const bytes = await limitedBody(response, 20 * 1024 * 1024);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const artifactId = `artifact_${publication.key}_${sha256.slice(0, 12)}`;
  database
    .prepare(
      `INSERT INTO source_artifact (
        id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size,
        sha256, storage_ref, http_etag, http_last_modified, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'fetched')
      ON CONFLICT(publication_id, sha256) DO UPDATE SET fetched_at = excluded.fetched_at, status = 'fetched'`,
    )
    .run(
      artifactId,
      publicationId,
      publication.downloadUrl,
      response.url || publication.downloadUrl,
      new Date().toISOString(),
      contentType,
      bytes.byteLength,
      sha256,
      response.headers.get("etag"),
      response.headers.get("last-modified"),
    );

  const stored = database.prepare("SELECT id FROM source_artifact WHERE publication_id = ? AND sha256 = ?").get(publicationId, sha256) as { id: string };
  let items;
  let observations;
  try {
    items = await extractPdfText(bytes);
    observations = parseHartiWholesale(items);
  } catch (error) {
    database.prepare("UPDATE source_artifact SET status = 'failed' WHERE id = ?").run(stored.id);
    throw error;
  }
  const transaction = database.transaction(() => {
    database.prepare("DELETE FROM extracted_text_item WHERE artifact_id = ?").run(stored.id);
    const insertText = database.prepare(
      `INSERT INTO extracted_text_item (artifact_id, page_number, item_index, text, x, y, width, height)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) insertText.run(stored.id, item.page, item.index, item.text, item.x, item.y, item.width, item.height);

    database.prepare("DELETE FROM staging_observation WHERE artifact_id = ?").run(stored.id);
    const insertObservation = database.prepare(
      `INSERT INTO staging_observation (
        id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label,
        source_date, price_type, currency, source_quantity, source_unit,
        min_value_minor, max_value_minor, status, raw_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'wholesale_observed', 'LKR', '1', 'kg', ?, ?, 'unmapped', ?)`,
    );
    for (const observation of observations) {
      insertObservation.run(
        newId("staging"),
        runId,
        stored.id,
        observation.rowRef,
        observation.itemLabel,
        observation.marketLabel,
        observation.date,
        observation.minValueMinor,
        observation.maxValueMinor,
        JSON.stringify(observation.raw),
      );
    }
    database.prepare("UPDATE source_artifact SET status = 'parsed' WHERE id = ?").run(stored.id);
  });
  transaction();
  return { fetched: 1, extracted: items.length, parsed: observations.length };
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
