import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { filesystemArchiveStorage } from "@lanka-pricelens/foundry/archive-storage";
import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { embeddedWarehouse } from "@lanka-pricelens/foundry/warehouse";
import { mappingBundleSchema, sourceManifestSchema } from "@lanka-pricelens/shared";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";

const manifest = sourceManifestSchema.parse({
  id: "keells_test",
  name: "Keells test",
  owner: "Test",
  landing_url: "https://www.keellssuper.com/",
  retrieval_method: "api_snapshot",
  expected_cadence: "daily",
  formats: ["json"],
  geographic_scope: "online_store_national",
  price_types: ["retail_online_store"],
  rights_status: "internal_evaluation",
  rights_evidence_ref: "docs/retail-capture.md",
  attribution_text: "Test attribution",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-09-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 3,
  enabled: true,
  adapter: { kind: "keells_api", settings: { minimumRecords: 10, maxAttempts: 1, maxConsecutiveFailures: 2, includeUnavailable: true, requestTimeoutMs: 5000 } },
});

const bundle = mappingBundleSchema.parse({
  schema_version: "1.0.0",
  mapping_version: "keells-test.1",
  source_id: "keells_test",
  reviewed_by: "tests",
  reviewed_at: "2026-09-01",
  evidence_ref: "docs/retail-capture.md",
  products: [{ id: "product_carrot", category: "vegetable", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null }],
  items: [
    { id: "item_carrot", product_id: "product_carrot", entity_type: "commodity", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_labels: ["Carrot"], expected_market_labels: ["Keells Online"] },
  ],
  markets: [{ id: "market_keells_online", type: "online_store", label_en: "Keells Online", label_si: null, label_ta: null, pcode: null, scope_note: "test", source_labels: ["Keells Online"] }],
  units: [{ id: "unit_kg_exact", source_unit: "kg", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" }],
  completeness: { minimum_item_coverage: 0.5, minimum_market_coverage: 1, minimum_cell_coverage: 0.5, minimum_mapping_coverage: 0.05, minimum_score: 0.1 },
});

const record = (index: number, label: string) => ({
  rowRef: `row-${index}`,
  itemLabel: label,
  marketLabel: "Keells Online",
  date: "2026-09-04",
  sourceQuantity: "1",
  sourceUnit: "kg",
  minValueMinor: 10000 + index * 100,
  maxValueMinor: 10000 + index * 100,
});

const snapshot = {
  schema_version: "1.0.0",
  source_id: "keells_test",
  capture_date: "2026-09-04",
  captured_at: "2026-09-04T08:24:00.000Z",
  adapter: "keells_api",
  records: [record(0, "Carrot"), ...Array.from({ length: 11 }, (_, index) => record(index + 1, `Test item ${index + 1}`))],
};

test("an exported snapshot posted by the owner is filed, priced, synced to the warehouse, and deduplicated", async () => {
  const database = openOperationalDatabase(":memory:");
  const salt = randomBytes(16).toString("hex");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
  const root = mkdtempSync(join(tmpdir(), "lpl-snapshots-"));
  const client = await embeddedWarehouse();
  try {
    const app = createApp(database, manifest, bundle, { warehouse: async () => client, archiveStorage: filesystemArchiveStorage(join(root, "archive")) });
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.request("http://localhost/v1/admin/sources/keells_test/snapshots", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

    assert.equal((await post(snapshot)).status, 401, "imports need a signed-in owner");
    const login = await app.request("http://localhost/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;

    const invalid = await post({ ...snapshot, records: [] }, { cookie });
    assert.equal(invalid.status, 400);
    const foreign = await post({ ...snapshot, source_id: "cargills_test" }, { cookie });
    assert.equal(foreign.status, 400);
    assert.equal((await app.request("http://localhost/v1/admin/sources/nowhere/snapshots", { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" })).status, 404);

    const imported = await post(snapshot, { cookie });
    const body = await imported.text();
    assert.equal(imported.status, 200, body);
    const payload = (JSON.parse(body) as { payload: { status: string; records: number; unchanged: boolean; capture_date: string; warehouse: { observations: number } | null } }).payload;
    assert.deepEqual([payload.status, payload.records, payload.unchanged, payload.capture_date], ["succeeded", 12, false, "2026-09-04"]);
    assert.ok(payload.warehouse && payload.warehouse.observations >= 1, "the warehouse catches up straight after the import");

    const run = database.prepare("SELECT trigger, status FROM ingest_run WHERE source_id = ? AND workflow = 'retail_capture'").get("keells_test") as { trigger: string; status: string };
    assert.deepEqual(run, { trigger: "import", status: "succeeded" });
    const priced = database.prepare("SELECT COUNT(*) AS count FROM price_observation WHERE status = 'active' AND item_id = 'item_carrot'").get() as { count: number };
    assert.equal(priced.count, 1);
    const warehoused = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM price_observation WHERE item_id = 'item_carrot'");
    assert.equal(Number(warehoused[0]?.count), 1);

    const again = await post(snapshot, { cookie });
    assert.equal(again.status, 200);
    const repeat = ((await again.json()) as { payload: { unchanged: boolean; warehouse: unknown }; message: string }).payload;
    assert.deepEqual([repeat.unchanged, repeat.warehouse], [true, null], "an identical snapshot is recognised and the warehouse is left alone");
  } finally {
    await client.close();
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
