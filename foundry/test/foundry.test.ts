import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mappingBundleSchema, sourceManifestSchema } from "@lanka-pricelens/shared";
import Database from "better-sqlite3";

import { persistExtractedText } from "../src/artifact.ts";
import { configuredArchiveStorage, filesystemArchiveStorage } from "../src/archive-storage.ts";
import { finishRun, finishStage, logStage, openOperationalDatabase, startRun, startStage, syncSource, type OperationalDatabase } from "../src/db.ts";
import {
  discoverHartiDaily,
  HartiParseError,
  parseHartiWholesale,
  parseHartiWholesaleWithDiagnostics,
} from "../src/harti.ts";
import { archiveManualArtifact, ingestManualPdf } from "../src/intake.ts";
import { canonicalizeRun } from "../src/mapping.ts";
import { retryProcessingStage, runIngestion, workflowRetryState, type ArchiveStorage } from "../src/pipeline.ts";
import type { PdfInspection, TextItem } from "../src/pdf.ts";
import { assessArtifactCompleteness } from "../src/quality.ts";
import { buildRelease } from "../src/release.ts";
import { archiveUriPrefix, claimNextDispatch, enqueueDueSchedules, enqueueProcessingRecovery, enqueueWorkflow, ensureWorkflowSchedules, recoverInterruptedDispatches } from "../src/workflows.ts";

const manifest = sourceManifestSchema.parse({
  id: "test_source",
  name: "Test source",
  owner: "Test owner",
  landing_url: "https://example.com/prices",
  retrieval_method: "scheduled_download",
  expected_cadence: "business_daily",
  formats: ["pdf"],
  geographic_scope: "test",
  price_types: ["wholesale_observed"],
  rights_status: "unknown",
  rights_evidence_ref: null,
  attribution_text: null,
  retention_policy: "metadata_and_checksum_only",
  parser_owner: null,
  reviewed_by: null,
  reviewed_at: "2026-08-17",
  review_due_at: "2026-11-17",
  request_interval_ms: 1000,
  max_attempts: 1,
  enabled: false,
});

test("admin password hashing accepts eight characters and rejects seven", () => {
  const cli = new URL("../src/cli.ts", import.meta.url);
  const accepted = spawnSync(process.execPath, [cli.pathname, "hash-password", "12345678"], { encoding: "utf8" });
  const rejected = spawnSync(process.execPath, [cli.pathname, "hash-password", "1234567"], { encoding: "utf8" });
  assert.equal(accepted.status, 0);
  assert.match(accepted.stdout, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}\n$/u);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /at least 8 characters/u);
});

test("rights gate blocks all network activity", async () => {
  const database = openOperationalDatabase(":memory:");
  let requests = 0;
  const result = await runIngestion(database, manifest, {
    trigger: "scheduled",
    request: async () => {
      requests += 1;
      return new Response();
    },
  });
  assert.equal(result.status, "blocked");
  assert.equal(requests, 0);
  database.close();
});

test("run lease prevents overlapping source runs", () => {
  const database = openOperationalDatabase(":memory:");
  syncSource(database, manifest);
  assert.equal(startRun(database, { sourceId: manifest.id, trigger: "test" }).started, true);
  assert.equal(startRun(database, { sourceId: manifest.id, trigger: "test" }).started, false);
  database.close();
});

test("scheduler creates one durable dispatch per due occurrence", () => {
  const database = openOperationalDatabase(":memory:");
  const now = new Date("2026-08-22T10:00:00.000Z");
  ensureWorkflowSchedules(database, manifest, now);
  database.prepare("UPDATE workflow_schedule SET next_run_at = ? WHERE workflow_key = 'latest_document_collection'").run(now.toISOString());
  assert.equal(enqueueDueSchedules(database, now), 1);
  assert.equal(enqueueDueSchedules(database, now), 0);
  const dispatch = claimNextDispatch(database, "test-scheduler", now);
  assert.equal(dispatch?.workflow_key, "latest_document_collection");
  assert.equal(dispatch?.status, "running");
  assert.equal((database.prepare("SELECT COUNT(*) AS count FROM workflow_dispatch").get() as { count: number }).count, 1);
  assert.equal(recoverInterruptedDispatches(database, new Date(now.getTime() + 61 * 60_000)), 1);
  assert.equal((database.prepare("SELECT status FROM workflow_dispatch WHERE id = ?").get(dispatch!.id) as { status: string }).status, "queued");
  database.close();
});

test("workflow lifecycle transitions create durable realtime events", () => {
  const database = openOperationalDatabase(":memory:");
  syncSource(database, manifest);
  const now = "2026-08-22T10:00:00.000Z";
  database.prepare(
    `INSERT INTO source_publication (
      id, source_id, source_publication_key, title, published_at, landing_url,
      download_url, status, first_seen_at, last_seen_at
    ) VALUES ('publication_events', ?, 'events', 'Events.pdf', ?, ?,
      'https://example.com/events.pdf', 'discovered', ?, ?)`,
  ).run(manifest.id, now, manifest.landing_url, now, now);
  database.prepare(
    `INSERT INTO archived_pdf (
      id, publication_id, source_url, r2_bucket, r2_key, r2_uri, byte_size,
      sha256, uploaded_at, status, created_at, updated_at
    ) VALUES ('archive_events', 'publication_events', 'https://example.com/events.pdf',
      'test', 'events.pdf', 'r2://test/events.pdf', 100, 'events-sha', ?, 'stored', ?, ?)`,
  ).run(now, now, now);

  const dispatch = enqueueWorkflow(database, {
    workflowKey: "document_processing_pipeline",
    sourceId: manifest.id,
    archiveId: "archive_events",
    requestedBy: "owner@example.com",
    now: new Date(now),
  });
  assert.equal(claimNextDispatch(database, "test-scheduler", new Date(now))?.id, dispatch.id);
  const run = startRun(database, {
    sourceId: manifest.id,
    trigger: "manual",
    workflow: "pdf_processing",
    archiveId: "archive_events",
    dispatchId: dispatch.id,
  });
  startStage(database, run.id, "retrieve_pdf", 1);
  logStage(database, run.id, "retrieve_pdf", "info", "PDF retrieved");
  finishStage(database, run.id, "retrieve_pdf", "succeeded", { outputCount: 1 });
  finishRun(database, run.id, "succeeded");

  const events = database.prepare(
    `SELECT event_type, dispatch_id, run_id, publication_id, stage, status
     FROM workflow_event ORDER BY id`,
  ).all() as Array<{ event_type: string; dispatch_id: string | null; run_id: string | null; publication_id: string | null; stage: string | null; status: string }>;
  assert.deepEqual(events.map((event) => `${event.event_type}:${event.status}`), [
    "dispatch:queued",
    "dispatch:running",
    "run:running",
    "stage:running",
    "stage:running",
    "stage:succeeded",
    "run:succeeded",
  ]);
  assert.ok(events.every((event) => event.publication_id === "publication_events"));
  assert.ok(events.every((event) => event.dispatch_id === dispatch.id));
  assert.equal(events.find((event) => event.event_type === "stage")?.run_id, run.id);
  database.close();
});

test("filesystem archive stores isolated objects and metadata", async () => {
  const root = mkdtempSync(join(tmpdir(), "lpl-archive-"));
  try {
    const archive = filesystemArchiveStorage(root);
    const bytes = new TextEncoder().encode("%PDF-local-test");
    await archive.upload("sources/test/document.pdf", "document.pdf", bytes, { sha256: "fixture" });
    const objects = await archive.list();
    assert.equal(objects.get("sources/test/document.pdf")?.customMetadata.sha256, "fixture");
    assert.deepEqual(await archive.download("sources/test/document.pdf"), bytes);
    await assert.rejects(() => archive.download("../outside.pdf"), /ARCHIVE_KEY_INVALID/u);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local-dev archive records resolve to filesystem storage without extra environment configuration", async () => {
  const root = mkdtempSync(join(tmpdir(), "lpl-local-dev-archive-"));
  const previousDriver = process.env.LPL_ARCHIVE_DRIVER;
  const previousRoot = process.env.LPL_LOCAL_ARCHIVE_ROOT;
  try {
    delete process.env.LPL_ARCHIVE_DRIVER;
    process.env.LPL_LOCAL_ARCHIVE_ROOT = root;
    const archive = await configuredArchiveStorage("local-dev");
    const bytes = new TextEncoder().encode("%PDF-local-bucket");
    await archive.upload("documents/local.pdf", "local.pdf", bytes, {});
    assert.deepEqual(await archive.download("documents/local.pdf"), bytes);
  } finally {
    if (previousDriver === undefined) delete process.env.LPL_ARCHIVE_DRIVER;
    else process.env.LPL_ARCHIVE_DRIVER = previousDriver;
    if (previousRoot === undefined) delete process.env.LPL_LOCAL_ARCHIVE_ROOT;
    else process.env.LPL_LOCAL_ARCHIVE_ROOT = previousRoot;
    rmSync(root, { force: true, recursive: true });
  }
});

test("HARTI discovery and coordinate parser produce dated price ranges", () => {
  const publications = discoverHartiDaily(
    '<a href="assets/pdf/food_price/daily/eng/2026/August/daily_16-08-2026.pdf">PDF</a><a href="https://evil.example/assets/pdf/food_price/daily/eng/2026/August/daily_15-08-2026.pdf">bad</a>',
    "https://example.com/daily-price.php",
  );
  assert.equal(publications[0]?.date, "2026-08-16");
  assert.equal(publications.length, 1);

  const observations = parseHartiWholesale(hartiItems());
  assert.equal(observations.length, 40);
  assert.deepEqual(
    { date: observations[0]?.date, minimum: observations[0]?.minValueMinor, maximum: observations[0]?.maxValueMinor },
    { date: "2026-08-16", minimum: 10_000, maximum: 12_000 },
  );
  assert.equal(observations.find((observation) => observation.itemLabel === "Anamalu (Rs/Fruits)")?.sourceUnit, "fruit");
  assert.equal(observations.find((observation) => observation.itemLabel === "Pineapple - Medium")?.sourceUnit, "kg");
  assert.equal(observations.find((observation) => observation.marketLabel === "Kandy")?.date, "2026-08-16");

  const movedObservations = parseHartiWholesale(hartiItems().map((item) => ({ ...item, page: 2 })));
  assert.equal(movedObservations[0]?.rowRef, "p2:y630.00");

  const minMaxObservations = parseHartiWholesale(hartiMinMaxItems());
  assert.equal(minMaxObservations.length, 10);
  assert.equal(minMaxObservations.find((observation) => observation.marketLabel === "Kandy")?.date, "2026-08-16");
  assert.equal(minMaxObservations.find((observation) => observation.marketLabel === "Veyangoda")?.date, "2026-08-15");
});

test("HARTI parser adapts to harmless header, date, and market-label variations", () => {
  const varied = hartiItems().map((textItem) => {
    if (textItem.text === "Variety") return { ...textItem, text: "  Commodity. " };
    if (textItem.text === "Nuwaraeliya") return { ...textItem, text: "Nuwara Eliya" };
    if (textItem.text === "2026.08.16") return { ...textItem, text: "2026-08-16" };
    if (textItem.text === "16/8/2026") return { ...textItem, text: "16-8-2026" };
    return textItem;
  });
  const result = parseHartiWholesaleWithDiagnostics(varied);
  assert.equal(result.observations.length, 40);
  assert.equal(result.diagnostics.strategy, "labelled_market_date_grid");
  assert.equal(result.diagnostics.headerLabel, "  Commodity. ");
  assert.ok(result.diagnostics.confidence >= 0.9);
  assert.equal(result.observations.find((observation) => observation.marketLabel === "Nuwaraeliya")?.date, "2026-08-16");

  const minMaxResult = parseHartiWholesaleWithDiagnostics(hartiMinMaxItems().map((textItem) => {
    if (textItem.text === "Item") return { ...textItem, text: "Product" };
    if (textItem.text === "Serial") return { ...textItem, text: "S. No." };
    if (textItem.text === "Min") return { ...textItem, text: "Minimum" };
    if (textItem.text === "Max") return { ...textItem, text: "Maximum" };
    return textItem;
  }));
  assert.equal(minMaxResult.observations.length, 10);
  assert.equal(minMaxResult.diagnostics.strategy, "min_max_market_grid");
});

test("HARTI parser can infer a missing label header from trusted table geometry", () => {
  const result = parseHartiWholesaleWithDiagnostics(hartiItems().filter((textItem) => textItem.text !== "Variety"));
  assert.equal(result.observations.length, 40);
  assert.equal(result.diagnostics.strategy, "inferred_market_date_grid");
  assert.equal(result.diagnostics.headerLabel, null);
  assert.ok(result.diagnostics.warnings.includes("label_header_inferred_from_table_geometry"));
});

test("HARTI parser evaluates later candidates after an earlier table-shaped candidate fails", () => {
  const invalidFirstPage = hartiItems().filter((textItem) => textItem.y >= 650);
  const validSecondPage = hartiItems().map((textItem) => ({ ...textItem, page: 2 }));
  const result = parseHartiWholesaleWithDiagnostics([...invalidFirstPage, ...validSecondPage]);
  assert.equal(result.observations.length, 40);
  assert.equal(result.diagnostics.page, 2);
  assert.ok(result.diagnostics.rejectedCandidates.some((candidate) => candidate.page === 1));
});

test("HARTI parser rejects an unrelated numeric grid instead of guessing", () => {
  assert.throws(
    () => parseHartiWholesaleWithDiagnostics(unrelatedGridItems()),
    (error) => error instanceof HartiParseError && error.code === "UNSUPPORTED_DOCUMENT",
  );
});

test("scheduled ingestion starts at latest, backfills pending, and catches up new publications", async () => {
  const database = openOperationalDatabase(":memory:");
  const archive = memoryArchive();
  const approved = sourceManifestSchema.parse({
    ...manifest,
    rights_status: "approved_permission",
    rights_evidence_ref: "test-fixture://permission",
    attribution_text: "Test source fixture",
    reviewed_by: "fixture-reviewer",
    review_due_at: "2999-12-31",
    enabled: true,
  });
  let html = archiveHtml(["16-08-2026", "15-08-2026"]);
  let requests: string[] = [];
  const request = async (url: string | URL | Request) => {
    const href = String(url);
    requests.push(href);
    return href === approved.landing_url
      ? new Response(html, { status: 200, headers: { "content-type": "text/html" } })
      : new Response(`%PDF-${href}`, { status: 200, headers: { "content-type": "application/pdf" } });
  };
  const inspector = async () => ({ inspection: pdfInspection(), items: hartiItems() });

  try {
    await runIngestion(database, approved, { trigger: "scheduled", request, inspector, archive });
    assert.equal(requests.length, 2);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM source_artifact").get() as { count: number }).count, 1);

    requests = [];
    await runIngestion(database, { ...approved, request_interval_ms: 1 }, { trigger: "backfill", request, inspector, archive });
    assert.equal(requests.length, 2);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM source_artifact").get() as { count: number }).count, 2);

    html = archiveHtml(["18-08-2026", "17-08-2026", "16-08-2026", "15-08-2026"]);
    requests = [];
    await runIngestion(database, { ...approved, request_interval_ms: 1 }, { trigger: "scheduled", request, inspector, archive });
    assert.equal(requests.length, 3);
    assert.equal((database.prepare("SELECT fetched_count FROM ingest_run WHERE workflow = 'source_sync' ORDER BY started_at DESC LIMIT 1").get() as { fetched_count: number }).fetched_count, 2);
  } finally {
    database.close();
  }
});

test("workflow retries enforce dependencies and resume from durable inputs", async () => {
  const database = openOperationalDatabase(":memory:");
  const archive = memoryArchive();
  const approved = sourceManifestSchema.parse({
    ...manifest,
    rights_status: "approved_permission",
    rights_evidence_ref: "test-fixture://permission",
    attribution_text: "Test source fixture",
    reviewed_by: "fixture-reviewer",
    review_due_at: "2999-12-31",
    retention_policy: "preserve_source_evidence",
    enabled: true,
  });
  let parseFails = true;
  const request = async (url: string | URL | Request) => String(url) === approved.landing_url
    ? new Response(archiveHtml(["16-08-2026"]), { status: 200, headers: { "content-type": "text/html" } })
    : new Response("%PDF-fixture", { status: 200, headers: { "content-type": "application/pdf" } });
  const inspector = async () => {
    if (parseFails) throw new Error("fixture parser failed");
    return { inspection: pdfInspection(), items: hartiItems() };
  };

  try {
    const sync = await runIngestion(database, approved, { trigger: "backfill", request, inspector, archive });
    const runId = sync.processingRunIds[0]!;
    assert.equal(workflowRetryState(database, runId, "extract_data").canRetry, false);
    assert.equal(workflowRetryState(database, runId, "parse_pdf").canRetry, true);

    parseFails = false;
    await retryProcessingStage(database, approved, runId, "parse_pdf", { inspector, archive });
    assert.equal(workflowRetryState(database, runId, "extract_data").canRetry, true);
    await retryProcessingStage(database, approved, runId, "extract_data", { archive });
    await retryProcessingStage(database, approved, runId, "validate_data", { archive });
    await retryProcessingStage(database, approved, runId, "insert_data", { archive });
    await retryProcessingStage(database, approved, runId, "assess_completeness", { archive });
    await retryProcessingStage(database, approved, runId, "canonicalize_data", { archive });

    assert.deepEqual(
      database.prepare("SELECT status FROM run_stage WHERE run_id = ? ORDER BY id").all(runId),
      Array.from({ length: 7 }, () => ({ status: "succeeded" })),
    );
    assert.equal((database.prepare("SELECT status FROM ingest_run WHERE id = ?").get(runId) as { status: string }).status, "succeeded");
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM run_stage_log WHERE run_id = ?").get(runId) as { count: number }).count > 0, true);
  } finally {
    database.close();
  }
});

test("structural parser failures are quarantined and a successful rerun resolves the issue", async () => {
  const database = openOperationalDatabase(":memory:");
  const archive = memoryArchive();
  const approved = sourceManifestSchema.parse({
    ...manifest,
    rights_status: "approved_permission",
    rights_evidence_ref: "test-fixture://permission",
    attribution_text: "Test source fixture",
    reviewed_by: "fixture-reviewer",
    review_due_at: "2999-12-31",
    retention_policy: "preserve_source_evidence",
    enabled: true,
  });
  const request = async (url: string | URL | Request) => String(url) === approved.landing_url
    ? new Response(archiveHtml(["16-08-2026"]), { status: 200, headers: { "content-type": "text/html" } })
    : new Response("%PDF-fixture", { status: 200, headers: { "content-type": "application/pdf" } });

  try {
    const sync = await runIngestion(database, approved, {
      trigger: "backfill",
      request,
      archive,
      inspector: async () => ({ inspection: pdfInspection(), items: unrelatedGridItems() }),
    });
    const runId = sync.processingRunIds[0]!;
    const run = database
      .prepare("SELECT status, artifact_id, quarantined_count FROM ingest_run WHERE id = ?")
      .get(runId) as { status: string; artifact_id: string; quarantined_count: number };
    assert.equal(run.status, "blocked");
    assert.equal(run.quarantined_count, 1);
    assert.deepEqual(
      database.prepare("SELECT status, reason_code FROM quarantine WHERE artifact_id = ?").get(run.artifact_id),
      { status: "open", reason_code: "UNSUPPORTED_DOCUMENT" },
    );

    persistExtractedText(database, run.artifact_id, hartiItems());
    await retryProcessingStage(database, approved, runId, "extract_data", { archive });
    await retryProcessingStage(database, approved, runId, "validate_data", { archive });
    await retryProcessingStage(database, approved, runId, "insert_data", { archive });
    await retryProcessingStage(database, approved, runId, "assess_completeness", { archive });
    await retryProcessingStage(database, approved, runId, "canonicalize_data", { archive });

    assert.equal((database.prepare("SELECT status FROM quarantine WHERE artifact_id = ?").get(run.artifact_id) as { status: string }).status, "resolved");
    assert.equal((database.prepare("SELECT quarantined_count FROM ingest_run WHERE id = ?").get(runId) as { quarantined_count: number }).quarantined_count, 0);
  } finally {
    database.close();
  }
});

test("manual PDF intake is monitored, idempotent, and quarantines OCR work", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const items = hartiItems();
    const parsed = await ingestManualPdf(database, manifest, {
      fileName: "fixture.pdf",
      bytes: new TextEncoder().encode("%PDF-fixture"),
      actor: "fixture-owner",
      inspector: async () => ({ inspection: pdfInspection(), items }),
    });
    assert.equal(parsed.status, "parsed");
    assert.equal(parsed.parsedCount, 40);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM staging_observation").get() as { count: number }).count, 40);
    const parserMetadata = database
      .prepare("SELECT parser_strategy, parser_confidence, parser_diagnostics_json FROM source_artifact WHERE id = ?")
      .get(parsed.artifactId) as { parser_strategy: string; parser_confidence: number; parser_diagnostics_json: string };
    assert.equal(parserMetadata.parser_strategy, "labelled_market_date_grid");
    assert.ok(parserMetadata.parser_confidence >= 0.9);
    assert.equal((JSON.parse(parserMetadata.parser_diagnostics_json) as { observationCount: number }).observationCount, 40);
    assert.equal(
      (database.prepare("SELECT action FROM audit_event WHERE target_id = ?").get(parsed.artifactId) as { action: string }).action,
      "manual_pdf_uploaded",
    );
    const archiveId = await archiveManualArtifact(database, manifest, {
      artifactId: parsed.artifactId,
      fileName: "fixture.pdf",
      bytes: new TextEncoder().encode("%PDF-fixture"),
      actor: "fixture-owner",
      archive: memoryArchive(),
    });
    assert.equal(
      (database.prepare("SELECT status FROM archived_pdf WHERE id = ?").get(archiveId) as { status: string }).status,
      "stored",
    );

    const partialOcr = await ingestManualPdf(database, manifest, {
      fileName: "partial-ocr.pdf",
      bytes: new TextEncoder().encode("%PDF-partial-ocr"),
      actor: "fixture-owner",
      inspector: async () => ({ inspection: pdfInspection({ pageCount: 2, pagesNeedingOcr: [2] }), items }),
    });
    assert.equal(partialOcr.status, "parsed");

    const duplicate = await ingestManualPdf(database, manifest, {
      fileName: "renamed.pdf",
      bytes: new TextEncoder().encode("%PDF-fixture"),
      actor: "fixture-owner",
      inspector: async () => {
        throw new Error("duplicate must not be inspected twice");
      },
    });
    assert.equal(duplicate.status, "duplicate");

    const quarantined = await ingestManualPdf(database, manifest, {
      fileName: "scan.pdf",
      bytes: new TextEncoder().encode("%PDF-scan"),
      actor: "fixture-owner",
      inspector: async () => ({ inspection: pdfInspection({ pdfType: "Scanned", pagesNeedingOcr: [1] }), items: [] }),
    });
    assert.equal(quarantined.status, "quarantined");
    assert.equal(quarantined.reason, "PDF_OCR_REQUIRED");

    const unrelated = await ingestManualPdf(database, manifest, {
      fileName: "unrelated.pdf",
      bytes: new TextEncoder().encode("%PDF-unrelated"),
      actor: "fixture-owner",
      inspector: async () => ({ inspection: pdfInspection(), items: unrelatedGridItems() }),
    });
    assert.equal(unrelated.status, "quarantined");
    assert.equal(unrelated.reason, "UNSUPPORTED_DOCUMENT");
    const quarantineDetails = database
      .prepare("SELECT details_json FROM quarantine WHERE artifact_id = ?")
      .get(unrelated.artifactId) as { details_json: string };
    assert.ok(Array.isArray((JSON.parse(quarantineDetails.details_json) as { rejected_candidates: unknown[] }).rejected_candidates));
  } finally {
    database.close();
  }
});

test("reviewed mappings create correction-safe observations and reconciled release artifacts", () => {
  const database = openOperationalDatabase(":memory:");
  const releaseRoot = mkdtempSync(join(tmpdir(), "lanka-pricelens-release-"));
  try {
    const approved = sourceManifestSchema.parse({
      ...manifest,
      rights_status: "approved_permission",
      rights_evidence_ref: "test-fixture://permission",
      attribution_text: "Test source fixture",
      reviewed_by: "fixture-reviewer",
      review_due_at: "2999-12-31",
      enabled: true,
    });
    syncSource(database, approved);
    const runId = insertStagingFixture(database, approved.id, "known", "Beans");

    const first = canonicalizeRun(database, runId, mappingBundle("item_beans", "Beans", "fixture-v1"), "fixture-parser@1");
    assert.deepEqual(first, { accepted: 1, corrected: 0, historical: 0, duplicates: 0, quarantined: 0, unmapped: 0 });
    const corrected = canonicalizeRun(
      database,
      runId,
      mappingBundle("item_green_beans", "Green beans", "fixture-v2"),
      "fixture-parser@1",
    );
    assert.equal(corrected.corrected, 1);
    assert.deepEqual(
      database.prepare("SELECT status, COUNT(*) AS count FROM price_observation GROUP BY status ORDER BY status").all(),
      [
        { status: "active", count: 1 },
        { status: "superseded", count: 1 },
      ],
    );

    const release = buildRelease(database, {
      dataVersion: "2026-08-17.1",
      outputRoot: releaseRoot,
      builtAt: "2026-08-17T12:00:00.000Z",
      buildCommit: "abcdef0",
      notes: "Fixture correction release.",
      actor: "fixture-release-manager",
    });
    assert.equal(release.recordCount, 1);
    for (const filename of [
      "prices.sqlite",
      "observations.csv",
      "observations.json",
      "manifest.json",
      "checksums.sha256",
      "NOTICE.txt",
      "RELEASE_NOTES.md",
    ]) {
      assert.equal(existsSync(join(release.path, filename)), true);
    }
    const manifestJson = JSON.parse(readFileSync(join(release.path, "manifest.json"), "utf8")) as { record_count: number };
    assert.equal(manifestJson.record_count, 1);
    const json = JSON.parse(readFileSync(join(release.path, "observations.json"), "utf8")) as {
      records: Array<Record<string, unknown>>;
    };
    assert.equal(json.records[0]?.item_id, "item_green_beans");
    assert.equal("source_manifest_json" in json.records[0]!, false);
    for (const line of readFileSync(join(release.path, "checksums.sha256"), "utf8").trim().split("\n")) {
      const [expected, filename] = line.split("  ");
      assert.equal(createHash("sha256").update(readFileSync(join(release.path, filename!))).digest("hex"), expected);
    }
    const publicDatabase = new Database(join(release.path, "prices.sqlite"), { readonly: true });
    assert.equal((publicDatabase.prepare("SELECT COUNT(*) AS count FROM observation").get() as { count: number }).count, 1);
    publicDatabase.close();
    assert.throws(
      () =>
        buildRelease(database, {
          dataVersion: "2026-08-17.1",
          outputRoot: releaseRoot,
          builtAt: "2026-08-17T12:00:00.000Z",
          buildCommit: "abcdef0",
          notes: "Must remain immutable.",
          actor: "fixture-release-manager",
        }),
      /DATA_VERSION_EXISTS/u,
    );

    const unknownRunId = insertStagingFixture(database, approved.id, "unknown", "Unreviewed item");
    const unknown = canonicalizeRun(
      database,
      unknownRunId,
      mappingBundle("item_green_beans", "Green beans", "fixture-v2"),
      "fixture-parser@1",
    );
    assert.equal(unknown.quarantined, 1);
    assert.equal(
      (database.prepare("SELECT reason_code FROM quarantine WHERE run_id = ?").get(unknownRunId) as { reason_code: string }).reason_code,
      "UNKNOWN_ITEM",
    );
    const resolved = canonicalizeRun(
      database,
      unknownRunId,
      mappingBundle("item_reviewed", "Reviewed item", "fixture-v3", "Unreviewed item"),
      "fixture-parser@1",
    );
    assert.equal(resolved.accepted, 1);
    assert.equal(
      (database.prepare("SELECT status FROM quarantine WHERE run_id = ?").get(unknownRunId) as { status: string }).status,
      "resolved",
    );
  } finally {
    database.close();
    rmSync(releaseRoot, { recursive: true });
  }
});

test("reviewed HARTI taxonomy contains 44 price series across 34 product families", () => {
  const path = new URL("../../data/mappings/harti_daily_food_prices.json", import.meta.url);
  const bundle = mappingBundleSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  assert.equal(bundle.items.length, 44);
  assert.equal(bundle.products.length, 34);
  assert.deepEqual(
    Object.fromEntries(
      ["vegetable", "fruit"].map((category) => [category, bundle.products.filter((product) => product.category === category).length]),
    ),
    { vegetable: 25, fruit: 9 },
  );
  assert.equal(bundle.items.flatMap((item) => item.expected_market_labels).length, 265);
  assert.equal(bundle.items.some((item) => item.source_labels.includes("- Medium")), false);
});

test("completeness is independent from parser confidence and records exact coverage", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const approved = sourceManifestSchema.parse({
      ...manifest,
      rights_status: "approved_permission",
      rights_evidence_ref: "test-fixture://permission",
      attribution_text: "Test source fixture",
      reviewed_by: "fixture-reviewer",
      review_due_at: "2999-12-31",
      enabled: true,
    });
    syncSource(database, approved);
    const runId = insertStagingFixture(database, approved.id, "quality", "Beans");
    const bundle = mappingBundle("item_beans", "Beans", "fixture-quality-v1");
    bundle.items[0]!.expected_market_labels = ["Peliyagoda"];
    const artifactId = (database.prepare("SELECT artifact_id FROM staging_observation WHERE run_id = ?").get(runId) as { artifact_id: string }).artifact_id;
    const quality = assessArtifactCompleteness(database, runId, artifactId, bundle);
    assert.equal(quality.status, "complete");
    assert.equal(quality.score, 1);
    assert.equal(quality.expectedCells, 1);
    assert.equal(quality.observedCells, 1);
    assert.deepEqual(
      database.prepare("SELECT status, score, expected_cells, observed_cells FROM artifact_quality_assessment").get(),
      { status: "complete", score: 1, expected_cells: 1, observed_cells: 1 },
    );
  } finally {
    database.close();
  }
});

test("later source publications remain effective when revisions are processed out of order", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const approved = sourceManifestSchema.parse({
      ...manifest,
      rights_status: "approved_permission",
      rights_evidence_ref: "test-fixture://permission",
      attribution_text: "Test source fixture",
      reviewed_by: "fixture-reviewer",
      review_due_at: "2999-12-31",
      enabled: true,
    });
    syncSource(database, approved);
    const olderRun = insertStagingFixture(database, approved.id, "revision_older", "Beans");
    const newerRun = insertStagingFixture(database, approved.id, "revision_newer", "Beans");
    database.prepare("UPDATE source_publication SET published_at = '2026-08-17T00:00:00.000Z' WHERE id = 'publication_revision_older'").run();
    database.prepare("UPDATE source_publication SET published_at = '2026-08-18T00:00:00.000Z' WHERE id = 'publication_revision_newer'").run();
    database.prepare("UPDATE staging_observation SET min_value_minor = 13000, max_value_minor = 15000 WHERE run_id = ?").run(newerRun);
    const bundle = mappingBundle("item_beans", "Beans", "fixture-revision-v1");

    assert.deepEqual(canonicalizeRun(database, newerRun, bundle, "fixture-parser@1"), {
      accepted: 1,
      corrected: 0,
      historical: 0,
      duplicates: 0,
      quarantined: 0, unmapped: 0,
    });
    assert.deepEqual(canonicalizeRun(database, olderRun, bundle, "fixture-parser@1"), {
      accepted: 0,
      corrected: 0,
      historical: 1,
      duplicates: 0,
      quarantined: 0, unmapped: 0,
    });
    assert.deepEqual(
      database
        .prepare(
          `SELECT publication.title, observation.status, observation.revision_reason
           FROM price_observation observation
           JOIN source_publication publication ON publication.id = observation.source_publication_id
           ORDER BY publication.published_at`,
        )
        .all(),
      [
        { title: "Fixture revision_older", status: "superseded", revision_reason: "historical_source_version" },
        { title: "Fixture revision_newer", status: "active", revision_reason: "initial_version" },
      ],
    );
    const rerun = canonicalizeRun(database, olderRun, bundle, "fixture-parser@1");
    assert.equal(rerun.duplicates, 1);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM price_observation").get() as { count: number }).count, 2);
  } finally {
    database.close();
  }
});

function item(index: number, text: string, x: number, y: number): TextItem {
  return { page: 1, index, text, x, y, width: 10, height: 8 };
}

function hartiItems(): TextItem[] {
  const markets = ["Peliyagoda", "Kandy", "Dambulla", "Meegoda", "Norochchole", "Thambuththegama", "Keppetipola", "Nuwaraeliya", "Bandarawela", "Veyangoda"];
  const items: TextItem[] = [item(0, "Variety", 50, 665)];
  markets.forEach((market, index) => {
    const x = 120 + index * 48;
    items.push(item(items.length, market, x, 665), item(items.length + 1, index % 2 ? "16/8/2026" : "2026.08.16", x, 677));
  });
  const labels = ["Beans", "Anamalu (Rs/Fruits)", "Pineapple - Large", "- Medium"];
  for (let row = 0; row < labels.length; row += 1) {
    const y = 630 - row * 12;
    items.push(item(items.length, labels[row]!, 35, y));
    markets.forEach((_, index) => {
      const x = 116 + index * 48;
      items.push(item(items.length, `${100 + row} -`, x, y), item(items.length + 1, String(120 + row), x + 22, y));
    });
  }
  return items;
}

function hartiMinMaxItems(): TextItem[] {
  const items: TextItem[] = [
    item(0, "Vegetable wholesale price in main markets on 16/08/2026 (Rs./kg)", 200, 720),
    item(1, "Serial", 50, 700),
    item(2, "Item", 90, 700),
  ];
  for (let market = 0; market < 10; market += 1) {
    const x = 160 + market * 60;
    items.push(item(items.length, "Min", x, 688), item(items.length + 1, "Max", x + 22, 688));
  }
  items.push(item(items.length, "1", 60, 670), item(items.length + 1, "Beans", 90, 670));
  for (let market = 0; market < 10; market += 1) {
    const x = 160 + market * 60;
    items.push(item(items.length, String(100 + market), x, 670), item(items.length + 1, String(120 + market), x + 22, 670));
  }
  items.push(item(items.length, "Meegoda and Veyangoda prices are previous day (15/08/2026)", 50, 650));
  return items;
}

function unrelatedGridItems(): TextItem[] {
  const unrelated: TextItem[] = [item(0, "Quarterly staffing report", 40, 720), item(1, "Department", 50, 665)];
  for (let column = 0; column < 10; column += 1) {
    const x = 120 + column * 48;
    unrelated.push(item(unrelated.length, "2026-08-16", x, 677));
  }
  for (let row = 0; row < 3; row += 1) {
    const y = 630 - row * 12;
    unrelated.push(item(unrelated.length, `Team ${row + 1}`, 35, y));
    for (let column = 0; column < 10; column += 1) {
      const x = 116 + column * 48;
      unrelated.push(item(unrelated.length, String(100 + row), x, y), item(unrelated.length + 1, String(120 + row), x + 22, y));
    }
  }
  return unrelated;
}

function archiveHtml(dates: string[]): string {
  return dates.map((date) => `<a href="assets/pdf/food_price/daily/eng/2026/August/daily_${date}.pdf">PDF</a>`).join("");
}

function memoryArchive(): ArchiveStorage {
  const objects = new Map<string, { bytes: Uint8Array; metadata: Record<string, string>; lastModified: string }>();
  return {
    bucket: "fixture-pdfs",
    list: async () => new Map(
      [...objects].map(([key, object]) => [key, {
        key,
        etag: createHash("md5").update(object.bytes).digest("hex"),
        size: object.bytes.byteLength,
        lastModified: object.lastModified,
        customMetadata: object.metadata,
      }]),
    ),
    upload: async (key, _filename, bytes, metadata) => {
      objects.set(key, { bytes, metadata, lastModified: new Date().toISOString() });
    },
    download: async (key) => {
      const object = objects.get(key);
      if (!object) throw new Error("R2_HTTP_404");
      return object.bytes;
    },
  };
}

function pdfInspection(overrides: Partial<PdfInspection> = {}): PdfInspection {
  return {
    engine: "pdf-inspector@1.14.2",
    pdfType: "TextBased",
    pageCount: 1,
    confidence: 1,
    processingTimeMs: 1,
    pagesNeedingOcr: [],
    pagesWithTables: [1],
    pagesWithColumns: [],
    hasEncodingIssues: false,
    ...overrides,
  };
}

function mappingBundle(itemId: string, itemLabel: string, version: string, sourceLabel = "Beans") {
  return mappingBundleSchema.parse({
    schema_version: "1.0.0",
    mapping_version: version,
    source_id: manifest.id,
    reviewed_by: "fixture-reviewer",
    reviewed_at: "2026-08-17",
    evidence_ref: "test-fixture://mapping-review",
    items: [
      {
        id: itemId,
        entity_type: "commodity",
        canonical_label_en: itemLabel,
        canonical_label_si: null,
        canonical_label_ta: null,
        variety: null,
        grade: null,
        source_labels: [sourceLabel],
      },
    ],
    markets: [
      {
        id: "market_peliyagoda",
        type: "wholesale_market",
        label_en: "Peliyagoda",
        label_si: null,
        label_ta: null,
        pcode: null,
        scope_note: "Test fixture market",
        source_labels: ["Peliyagoda"],
      },
    ],
    units: [
      {
        id: "unit_kg_exact",
        source_unit: "kg",
        normalized_unit: "kg",
        factor_numerator: 1,
        factor_denominator: 1,
        rounding_mode: "half_away_from_zero",
      },
    ],
  });
}

function insertStagingFixture(
  database: OperationalDatabase,
  sourceId: string,
  suffix: string,
  sourceItemLabel: string,
): string {
  const run = startRun(database, { sourceId, trigger: "fixture" });
  assert.equal(run.started, true);
  const publicationId = `publication_${suffix}`;
  const artifactId = `artifact_${suffix}`;
  const now = "2026-08-17T10:00:00.000Z";
  database
    .prepare(
      `INSERT INTO source_publication (
        id, source_id, source_publication_key, title, published_at, observed_from, observed_to,
        landing_url, download_url, status, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, '2026-08-16T00:00:00.000Z', '2026-08-16', '2026-08-16',
        'https://example.com/prices', 'https://example.com/prices.pdf', 'discovered', ?, ?)`,
    )
    .run(publicationId, sourceId, suffix, `Fixture ${suffix}`, now, now);
  database
    .prepare(
      `INSERT INTO source_artifact (
        id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status
      ) VALUES (?, ?, 'https://example.com/prices.pdf', 'https://example.com/prices.pdf', ?,
        'application/pdf', 100, ?, 'parsed')`,
    )
    .run(artifactId, publicationId, now, suffix.padEnd(64, "0"));
  database
    .prepare(
      `INSERT INTO staging_observation (
        id, run_id, artifact_id, source_row_ref, source_item_label, source_market_label,
        source_date, price_type, currency, source_quantity, source_unit,
        min_value_minor, max_value_minor, status, raw_json
      ) VALUES (?, ?, ?, 'p1:y100', ?, 'Peliyagoda', '2026-08-16', 'wholesale_observed',
        'LKR', '1', 'kg', 10000, 12000, 'unmapped', '{}')`,
    )
    .run(`staging_${suffix}`, run.id, artifactId, sourceItemLabel);
  finishRun(database, run.id, "succeeded");
  return run.id;
}

test("processing recovery re-queues documents that were processed without a mapping bundle", () => {
  const database = openOperationalDatabase(":memory:");
  syncSource(database, manifest);
  const now = "2026-08-22T10:00:00.000Z";
  database.prepare(
    `INSERT INTO source_publication (
      id, source_id, source_publication_key, title, published_at, landing_url,
      download_url, status, first_seen_at, last_seen_at
    ) VALUES ('publication_unconfigured', ?, 'unconfigured', 'Unconfigured.pdf', ?, ?,
      'https://example.com/unconfigured.pdf', 'parsed', ?, ?)`,
  ).run(manifest.id, now, manifest.landing_url, now, now);
  database.prepare(
    `INSERT INTO archived_pdf (
      id, publication_id, source_url, r2_bucket, r2_key, r2_uri, byte_size,
      sha256, uploaded_at, status, created_at, updated_at
    ) VALUES ('archive_unconfigured', 'publication_unconfigured', 'https://example.com/unconfigured.pdf',
      'test', 'unconfigured.pdf', 'r2://test/unconfigured.pdf', 100, 'unconfigured-sha', ?, 'stored', ?, ?)`,
  ).run(now, now, now);
  const run = startRun(database, { sourceId: manifest.id, trigger: "manual", workflow: "pdf_processing", archiveId: "archive_unconfigured" });
  finishRun(database, run.id, "succeeded");
  database.prepare(
    `INSERT INTO source_artifact (
      id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status, run_id
    ) VALUES ('artifact_unconfigured', 'publication_unconfigured', 'https://example.com/unconfigured.pdf',
      'https://example.com/unconfigured.pdf', ?, 'application/pdf', 100, ?, 'parsed', ?)`,
  ).run(now, "unconfigured".padEnd(64, "0"), run.id);
  database.prepare(
    `INSERT INTO artifact_quality_assessment (
      artifact_id, run_id, mapping_version, status, score, item_coverage, market_coverage, cell_coverage, mapping_coverage,
      expected_items, observed_items, expected_markets, observed_markets, expected_cells, observed_cells,
      total_rows, mapped_rows, unknown_item_rows, unknown_market_rows, unknown_unit_rows, diagnostics_json, assessed_at
    ) VALUES ('artifact_unconfigured', ?, NULL, 'not_configured', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 5, 5, 5, '{}', ?)`,
  ).run(run.id, now);

  // An older archive that already failed through a recovery dispatch must not starve the sweep.
  database.prepare(
    `INSERT INTO source_publication (
      id, source_id, source_publication_key, title, published_at, landing_url,
      download_url, status, first_seen_at, last_seen_at
    ) VALUES ('publication_stuck', ?, 'stuck', 'Stuck.pdf', ?, ?, 'https://example.com/stuck.pdf', 'archived', ?, ?)`,
  ).run(manifest.id, "2026-08-01T10:00:00.000Z", manifest.landing_url, now, now);
  database.prepare(
    `INSERT INTO archived_pdf (
      id, publication_id, source_url, r2_bucket, r2_key, r2_uri, byte_size,
      sha256, uploaded_at, status, created_at, updated_at
    ) VALUES ('archive_stuck', 'publication_stuck', 'https://example.com/stuck.pdf',
      'test', 'stuck.pdf', 'r2://test/stuck.pdf', 100, 'stuck-sha', ?, 'stored', ?, ?)`,
  ).run("2026-08-01T10:00:00.000Z", now, now);
  assert.equal(enqueueProcessingRecovery(database, manifest.id, 1, now), 1);
  database.prepare("UPDATE workflow_dispatch SET status = 'failed' WHERE archive_id = 'archive_stuck'").run();

  // The run "succeeded" but published nothing, so the sweep must pick the document up again,
  // even with a limit of one and an older failed archive ahead of it.
  assert.equal(enqueueProcessingRecovery(database, manifest.id, 1, now), 1);
  const queued = database
    .prepare("SELECT status, trigger FROM workflow_dispatch WHERE archive_id = 'archive_unconfigured'")
    .get() as { status: string; trigger: string };
  assert.deepEqual(queued, { status: "queued", trigger: "recovery" });
  // While that request is queued a second sweep must not duplicate it.
  assert.equal(enqueueProcessingRecovery(database, manifest.id, 10, now), 0);
  // A storage prefix limits the sweep to documents the configured driver can actually read.
  database.prepare("DELETE FROM workflow_dispatch WHERE archive_id = 'archive_unconfigured'").run();
  assert.equal(enqueueProcessingRecovery(database, manifest.id, 10, now, "file:///archive/"), 0);
  assert.equal(enqueueProcessingRecovery(database, manifest.id, 10, now, "r2://test/"), 1);
  assert.equal(archiveUriPrefix({ uri: (key) => `r2://bucket/${key}` }), "r2://bucket/");
  assert.equal(archiveUriPrefix({}), null);
  // Once the assessment is real, a succeeded run means the document is done.
  database.prepare("DELETE FROM workflow_dispatch WHERE archive_id = 'archive_unconfigured'").run();
  database.prepare("UPDATE artifact_quality_assessment SET status = 'complete', score = 1 WHERE artifact_id = 'artifact_unconfigured'").run();
  assert.equal(enqueueProcessingRecovery(database, manifest.id, 10, now), 0);
});
