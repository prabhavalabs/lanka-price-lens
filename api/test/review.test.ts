import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";

const manifest = sourceManifestSchema.parse({
  id: "cbsl",
  name: "CBSL daily price report",
  owner: "Central Bank of Sri Lanka",
  landing_url: "https://cbsl.example/prices",
  retrieval_method: "scheduled_download",
  expected_cadence: "daily",
  formats: ["pdf"],
  geographic_scope: "selected_wholesale_markets",
  price_types: ["retail_observed"],
  rights_status: "approved_permission",
  rights_evidence_ref: "docs/source-permission.md",
  attribution_text: "Source: CBSL",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-01-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 3,
  enabled: true,
  retry: { attempts: 1, cooldown_minutes: 0 },
});

test("a quarantined document can be marked reviewed by hand and leaves the failed list", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
  try {
    const app = createApp(database, manifest);
    const now = "2026-09-05T10:00:00.000Z";
    // A scanned report: archived, processed, quarantined because its pages have no text layer.
    database.exec(`
      INSERT INTO source_publication (id, source_id, source_publication_key, title, published_at, landing_url, download_url, status, first_seen_at, last_seen_at)
      VALUES ('publication_scan', 'cbsl', 'scan', 'Daily Price Report - 15 April 2026', '2026-04-15T00:00:00.000Z', 'u', 'https://cbsl.example/scan.pdf', 'quarantined', '${now}', '${now}');
      INSERT INTO archived_pdf (id, publication_id, source_url, r2_bucket, r2_key, r2_uri, byte_size, sha256, uploaded_at, status, created_at, updated_at)
      VALUES ('archive_scan', 'publication_scan', 'https://cbsl.example/scan.pdf', 'test', 'scan.pdf', 'r2://test/scan.pdf', 100, 'scan-sha', '${now}', 'stored', '${now}', '${now}');
      INSERT INTO ingest_run (id, source_id, trigger, status, workflow, archive_id, started_at, finished_at, heartbeat_at, lease_expires_at, error_code, error_message)
      VALUES ('run_scan', 'cbsl', 'scheduled', 'blocked', 'pdf_processing', 'archive_scan', '${now}', '${now}', '${now}', '${now}', 'PDF_OCR_REQUIRED', 'PDF_OCR_REQUIRED: pages 1,2');
      INSERT INTO source_artifact (id, publication_id, requested_url, final_url, fetched_at, media_type, byte_size, sha256, status, run_id)
      VALUES ('artifact_scan', 'publication_scan', 'u', 'u', '${now}', 'application/pdf', 100, '${"scan".padEnd(64, "0")}', 'quarantined', 'run_scan');
      INSERT INTO quarantine (id, run_id, artifact_id, reason_code, details_json, status, created_at)
      VALUES ('quarantine_scan', 'run_scan', 'artifact_scan', 'PDF_OCR_REQUIRED', '{}', 'open', '${now}');
    `);
    const login = await app.request("http://localhost/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
    const review = (path: string, body: unknown) => app.request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

    const before = (await (await app.request("http://localhost/v1/admin/knowledge-base?status=failed", { headers: { cookie } })).json()) as { payload: { total: number } };
    assert.equal(before.payload.total, 1);
    assert.equal((await app.request("http://localhost/v1/admin/knowledge-base/publication_scan/review", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
    assert.equal((await review("/v1/admin/knowledge-base/publication_scan/review", { note: "" })).status, 400, "a note is required");
    assert.equal((await review("/v1/admin/knowledge-base/publication_missing/review", { note: "scanned pages" })).status, 404);

    const done = await review("/v1/admin/knowledge-base/publication_scan/review", { note: "Scanned pages without a text layer; OCR is not supported." });
    assert.equal(done.status, 200);
    const payload = ((await done.json()) as { payload: { quarantines_resolved: number; artifacts_reviewed: number } }).payload;
    assert.deepEqual([payload.quarantines_resolved, payload.artifacts_reviewed], [1, 1]);
    const quarantine = database.prepare("SELECT status, resolution_note FROM quarantine WHERE id = 'quarantine_scan'").get() as { status: string; resolution_note: string };
    assert.equal(quarantine.status, "resolved");
    assert.match(quarantine.resolution_note, /owner@example.com: Scanned pages/u);
    assert.deepEqual(database.prepare("SELECT (SELECT status FROM source_artifact WHERE id = 'artifact_scan') AS artifact, (SELECT status FROM source_publication WHERE id = 'publication_scan') AS publication").get(), { artifact: "reviewed", publication: "reviewed" });

    const after = (await (await app.request("http://localhost/v1/admin/knowledge-base?status=failed", { headers: { cookie } })).json()) as { payload: { total: number } };
    assert.equal(after.payload.total, 0, "the document has left the failed list");
    const reviewed = (await (await app.request("http://localhost/v1/admin/knowledge-base?status=reviewed", { headers: { cookie } })).json()) as { payload: { total: number; items: Array<{ index_status: string }> } };
    assert.deepEqual([reviewed.payload.total, reviewed.payload.items[0]?.index_status], [1, "reviewed"]);
  } finally {
    database.close();
  }
});
