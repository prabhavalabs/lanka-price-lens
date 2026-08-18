import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mappingBundleSchema, sourceManifestSchema } from "@lanka-pricelens/shared";
import Database from "better-sqlite3";

import { finishRun, openOperationalDatabase, startRun, syncSource, type OperationalDatabase } from "../src/db.ts";
import { discoverHartiDaily, parseHartiWholesale } from "../src/harti.ts";
import { ingestManualPdf } from "../src/intake.ts";
import { canonicalizeRun } from "../src/mapping.ts";
import { runIngestion } from "../src/pipeline.ts";
import type { PdfInspection, TextItem } from "../src/pdf.ts";
import { buildRelease } from "../src/release.ts";

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

test("HARTI discovery and coordinate parser produce dated price ranges", () => {
  const publications = discoverHartiDaily(
    '<a href="assets/pdf/food_price/daily/eng/2026/August/daily_16-08-2026.pdf">PDF</a><a href="https://evil.example/assets/pdf/food_price/daily/eng/2026/August/daily_15-08-2026.pdf">bad</a>',
    "https://example.com/daily-price.php",
  );
  assert.equal(publications[0]?.date, "2026-08-16");
  assert.equal(publications.length, 1);

  const observations = parseHartiWholesale(hartiItems());
  assert.equal(observations.length, 20);
  assert.deepEqual(
    { date: observations[0]?.date, minimum: observations[0]?.minValueMinor, maximum: observations[0]?.maxValueMinor },
    { date: "2026-08-16", minimum: 10_000, maximum: 12_000 },
  );
});

test("scheduled ingestion starts at latest, backfills pending, and catches up new publications", async () => {
  const database = openOperationalDatabase(":memory:");
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
    await runIngestion(database, approved, { trigger: "scheduled", request, inspector });
    assert.equal(requests.length, 2);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM source_artifact").get() as { count: number }).count, 1);

    requests = [];
    await runIngestion(database, { ...approved, request_interval_ms: 1 }, { trigger: "backfill", request, inspector });
    assert.equal(requests.length, 2);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM source_artifact").get() as { count: number }).count, 2);

    html = archiveHtml(["18-08-2026", "17-08-2026", "16-08-2026", "15-08-2026"]);
    requests = [];
    await runIngestion(database, { ...approved, request_interval_ms: 1 }, { trigger: "scheduled", request, inspector });
    assert.equal(requests.length, 3);
    assert.equal((database.prepare("SELECT fetched_count FROM ingest_run ORDER BY started_at DESC LIMIT 1").get() as { fetched_count: number }).fetched_count, 2);
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
    assert.equal(parsed.parsedCount, 20);
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM staging_observation").get() as { count: number }).count, 20);
    assert.equal(
      (database.prepare("SELECT action FROM audit_event WHERE target_id = ?").get(parsed.artifactId) as { action: string }).action,
      "manual_pdf_uploaded",
    );

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
    assert.deepEqual(first, { accepted: 1, corrected: 0, duplicates: 0, quarantined: 0 });
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

function item(index: number, text: string, x: number, y: number): TextItem {
  return { page: 1, index, text, x, y, width: 10, height: 8 };
}

function hartiItems(): TextItem[] {
  const markets = ["Peliyagoda", "Kandy", "Dambulla", "Meegoda", "Norochchole", "Thambuththegama", "Keppetipola", "Nuwaraeliya", "Bandarawela", "Veyangoda"];
  const items: TextItem[] = [item(0, "Variety", 50, 665)];
  markets.forEach((market, index) => {
    const x = 120 + index * 48;
    items.push(item(items.length, market, x, 665), item(items.length + 1, "2026.08.16", x, 677));
  });
  for (let row = 0; row < 2; row += 1) {
    const y = 630 - row * 12;
    items.push(item(items.length, row ? "Carrot" : "Beans", 35, y));
    markets.forEach((_, index) => {
      const x = 116 + index * 48;
      items.push(item(items.length, `${100 + row} -`, x, y), item(items.length + 1, String(120 + row), x + 22, y));
    });
  }
  return items;
}

function archiveHtml(dates: string[]): string {
  return dates.map((date) => `<a href="assets/pdf/food_price/daily/eng/2026/August/daily_${date}.pdf">PDF</a>`).join("");
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
