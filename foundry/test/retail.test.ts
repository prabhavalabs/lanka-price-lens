import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mappingBundleSchema, sourceManifestSchema } from "@lanka-pricelens/shared";

import { filesystemArchiveStorage } from "../src/archive-storage.ts";
import { openOperationalDatabase, type OperationalDatabase } from "../src/db.ts";
import { cargillsAdapter, cargillsPack } from "../src/retail/adapters/cargills.ts";
import { glomarkAdapter, parseGlomarkProducts } from "../src/retail/adapters/glomark.ts";
import { keellsAdapter, keellsPack } from "../src/retail/adapters/keells.ts";
import { sparAdapter, sparPack } from "../src/retail/adapters/spar.ts";
import { pauseHours } from "../src/retail/capture.ts";
import { backoff, CookieJar, fetchWithPolicy } from "../src/retail/http.ts";
import {
  resolveAdapterSettings,
  resumeSourceCapture,
  retailAdapterFor,
  runRetailCapture,
  saveAdapterSettings,
  SettingsError,
  settingsJsonSchema,
} from "../src/retail/index.ts";
import { packFromLabel, priceToMinor } from "../src/retail/types.ts";
import { applicableWorkflowDefinitions, ensureWorkflowSchedules } from "../src/workflows.ts";

const fixturesRoot = new URL("./fixtures/retail/", import.meta.url);
const fixture = (name: string): string => readFileSync(new URL(name, fixturesRoot), "utf8");

const keellsItems = JSON.parse(fixture("keells-items.json")) as { result: { itemDetailResult: { itemDetails: Array<{ name: string; amount: number; uom: string; isAvailable: boolean }> } } };
const guestBody = fixture("keells-guest.json");

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
  products: [
    { id: "product_carrot", category: "vegetable", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null },
    { id: "product_big_onion", category: "vegetable", canonical_label_en: "Big Onion", canonical_label_si: null, canonical_label_ta: null },
  ],
  items: [
    { id: "item_carrot", product_id: "product_carrot", entity_type: "commodity", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_labels: ["Carrot"], expected_market_labels: ["Keells Online"] },
    { id: "item_big_onion", product_id: "product_big_onion", entity_type: "commodity", canonical_label_en: "Big Onion", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_labels: ["Big Onions"], expected_market_labels: ["Keells Online"] },
  ],
  markets: [{ id: "market_keells_online", type: "online_store", label_en: "Keells Online", label_si: null, label_ta: null, pcode: null, scope_note: "test", source_labels: ["Keells Online"] }],
  units: [
    { id: "unit_kg_exact", source_unit: "kg", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" },
    { id: "unit_g_to_kg", source_unit: "g", normalized_unit: "kg", factor_numerator: 1, factor_denominator: 1000, rounding_mode: "half_away_from_zero" },
    { id: "unit_piece_exact", source_unit: "piece", normalized_unit: "piece", factor_numerator: 1, factor_denominator: 1, rounding_mode: "half_away_from_zero" },
  ],
  completeness: { minimum_item_coverage: 0.5, minimum_market_coverage: 1, minimum_cell_coverage: 0.5, minimum_mapping_coverage: 0.05, minimum_score: 0.1 },
});

type Handler = (url: string, init?: RequestInit) => Response;

function fakeHttp(handler: Handler): { http: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { http, calls };
}

function keellsResponder(items = keellsItems.result.itemDetailResult.itemDetails): Handler {
  return (url, init) => {
    if (url.includes("/GuestLogin")) {
      assert.equal(init?.method, "POST");
      return new Response(guestBody, { status: 200, headers: { "content-type": "application/json", "set-cookie": "ARRAffinity=abc123; Path=/; HttpOnly" } });
    }
    if (url.includes("/GetItemDetails")) {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("usersessionid"), "test-session-id");
      assert.match(headers.get("cookie") ?? "", /ARRAffinity=abc123/u);
      return Response.json({ statusCode: 200, result: { itemDetailResult: { pageCount: 1, itemDetails: items } } });
    }
    throw new Error(`unexpected ${url}`);
  };
}

function temporaryDatabase(): { database: OperationalDatabase; root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "lpl-retail-"));
  const database = openOperationalDatabase(join(root, "operations.sqlite"));
  return { database, root, cleanup: () => { database.close(); rmSync(root, { recursive: true, force: true }); } };
}

test("pack and price helpers read retailer conventions", () => {
  assert.deepEqual(sparPack("WT / 1000", "CARROTS"), { quantity: "1000", unit: "g" });
  assert.deepEqual(sparPack("WT", "GARLIC"), { quantity: "1", unit: "kg" });
  assert.deepEqual(sparPack("Default Title", "Papaya, each (about 1.2kg)"), { quantity: "1", unit: "piece" });
  assert.deepEqual(keellsPack("KG", "Carrot"), { quantity: "1", unit: "kg" });
  assert.deepEqual(keellsPack("NO", "Basil Leaves 50g"), { quantity: "50", unit: "g" });
  assert.deepEqual(keellsPack("NO", "Coconut"), { quantity: "1", unit: "piece" });
  assert.deepEqual(cargillsPack(500, "g"), { quantity: "500", unit: "g" });
  assert.deepEqual(cargillsPack("3.0", "pcs"), { quantity: "3", unit: "piece" });
  assert.deepEqual(packFromLabel("Myco Farm Abalone Mushroom 200G"), { quantity: "200", unit: "g" });
  assert.equal(priceToMinor("1,345.00"), 134_500);
  assert.equal(priceToMinor(157.5), 15_750);
  assert.equal(pauseHours(0), 6);
  assert.equal(pauseHours(2), 24);
  assert.equal(pauseHours(9), 48);
});

test("adapters normalise captured payloads into the unified record shape", () => {
  const spar = sparAdapter.normalize({ fetchedAt: "2026-09-04T01:00:00.000Z", requests: 1, data: { collections: [{ handle: "vegetables", products: (JSON.parse(fixture("spar-vegetables.json")) as { products: unknown[] }).products }] } }, sparAdapter.settingsSchema.parse({}), "2026-09-04");
  const carrots = spar.find((record) => record.itemLabel === "CARROTS");
  assert.ok(carrots);
  assert.deepEqual([carrots.sourceQuantity, carrots.sourceUnit, carrots.minValueMinor, carrots.marketLabel], ["1000", "g", 36_000, "SPAR Online"]);
  assert.equal(spar.find((record) => record.itemLabel === "GARLIC")?.sourceUnit, "kg");
  assert.equal(new Set(spar.map((record) => record.rowRef)).size, spar.length);

  const keells = keellsAdapter.normalize({ fetchedAt: "", requests: 1, data: { departments: [{ departmentId: 16, pages: 1, items: keellsItems.result.itemDetailResult.itemDetails }] } }, keellsAdapter.settingsSchema.parse({ includeUnavailable: true }), "2026-09-04");
  const carrot = keells.find((record) => record.itemLabel === "Carrot");
  assert.ok(carrot);
  assert.equal(carrot.sourceUnit, "kg");
  assert.equal(carrot.minValueMinor, priceToMinor(keellsItems.result.itemDetailResult.itemDetails.find((item) => item.name.trim() === "Carrot")!.amount));
  assert.ok(keells.every((record) => record.itemLabel === record.itemLabel.trim()), "labels are trimmed");

  const cargills = cargillsAdapter.normalize({ fetchedAt: "", requests: 1, data: { categories: [{ categoryId: "MjM=", items: JSON.parse(fixture("cargills-items.json")) }] } }, cargillsAdapter.settingsSchema.parse({}), "2026-09-04");
  const cargillsCarrot = cargills.find((record) => record.itemLabel === "Carrot");
  assert.ok(cargillsCarrot);
  assert.deepEqual([cargillsCarrot.sourceQuantity, cargillsCarrot.sourceUnit, cargillsCarrot.minValueMinor], ["500", "g", 18_000]);
  assert.equal(cargills.find((record) => record.itemLabel === "Coconut")?.sourceUnit, "piece");

  const glomarkProducts = parseGlomarkProducts(fixture("glomark-category.html"), "/fresh/vegetable/c/1", 1);
  assert.ok(glomarkProducts.length >= 15, `parsed ${glomarkProducts.length} cards`);
  const cabbage = glomarkProducts.find((product) => product.name === "Chinese Cabbage");
  assert.deepEqual(cabbage && [cabbage.quantity, cabbage.unit, cabbage.price, cabbage.id], ["100", "g", 90, "12720"]);
  const glomark = glomarkAdapter.normalize({ fetchedAt: "", requests: 1, data: { pages: [{ path: "/x", page: 1, products: glomarkProducts }] } }, glomarkAdapter.settingsSchema.parse({}), "2026-09-04");
  assert.equal(glomark.find((record) => record.itemLabel === "Chinese Cabbage")?.minValueMinor, 9_000);
});

test("http policy retries transient failures, stops on client errors, and keeps cookies", async () => {
  let attempts = 0;
  const { http } = fakeHttp(() => {
    attempts += 1;
    return attempts < 3 ? new Response("busy", { status: 503 }) : new Response("ok", { status: 200 });
  });
  const result = await fetchWithPolicy(http, "https://example.test/x", {}, { attempts: 3, timeoutMs: 1000, userAgent: "t", baseDelayMs: 1, maxDelayMs: 2 });
  assert.equal(result.attempts, 3);
  assert.equal(new TextDecoder().decode(result.body), "ok");

  let clientAttempts = 0;
  const forbidden = fakeHttp(() => { clientAttempts += 1; return new Response("no", { status: 403 }); });
  await assert.rejects(fetchWithPolicy(forbidden.http, "https://example.test/y", {}, { attempts: 3, timeoutMs: 1000, userAgent: "t", baseDelayMs: 1 }), /SOURCE_HTTP_403/u);
  assert.equal(clientAttempts, 1, "4xx responses are not retried");

  const jar = new CookieJar();
  jar.absorb(["a=1; Path=/", "b=2; HttpOnly", "a=3"]);
  assert.equal(jar.header(), "a=3; b=2");
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const delay = backoff(attempt, 600, 8000);
    assert.ok(delay <= 8000 && delay >= 0);
  }
});

test("settings merge manifest defaults with reviewed overrides and reject bad values", () => {
  const { database, cleanup } = temporaryDatabase();
  try {
    const adapter = retailAdapterFor(manifest);
    assert.ok(adapter);
    assert.equal(adapter.kind, "keells_api");
    const before = resolveAdapterSettings(database, manifest, adapter);
    assert.equal(before.minimumRecords, 10);
    assert.throws(() => saveAdapterSettings(database, manifest, adapter, { maxAttempts: 99 }, "tests"), SettingsError);
    saveAdapterSettings(database, manifest, adapter, { minimumRecords: 3, outletCode: "KOTT" }, "tests");
    const after = resolveAdapterSettings(database, manifest, adapter) as unknown as { minimumRecords: number; outletCode: string; maxAttempts: number };
    assert.deepEqual([after.minimumRecords, after.outletCode, after.maxAttempts], [3, "KOTT", 1]);
    const schema = settingsJsonSchema(adapter) as { properties: Record<string, { description?: string }> };
    assert.ok(schema.properties.departmentIds);
    assert.ok(schema.properties.minimumRecords?.description);
    const audit = database.prepare("SELECT COUNT(*) AS count FROM audit_event WHERE action = 'adapter.settings.updated'").get() as { count: number };
    assert.equal(audit.count, 1);
  } finally {
    cleanup();
  }
});

test("retail sources schedule only the capture workflow", () => {
  const { database, cleanup } = temporaryDatabase();
  try {
    assert.deepEqual(applicableWorkflowDefinitions(manifest).map((definition) => definition.key), ["retail_price_capture"]);
    assert.ok(!applicableWorkflowDefinitions({ adapter: null }).some((definition) => definition.key === "retail_price_capture"));
    ensureWorkflowSchedules(database, manifest);
    const schedules = database.prepare("SELECT workflow_key FROM workflow_schedule WHERE source_id = ?").all(manifest.id) as Array<{ workflow_key: string }>;
    assert.deepEqual(schedules.map((schedule) => schedule.workflow_key), ["retail_price_capture"]);
  } finally {
    cleanup();
  }
});

test("capture stores a snapshot once, promotes mapped prices, and dedupes identical re-captures", async () => {
  const { database, root, cleanup } = temporaryDatabase();
  try {
    const adapter = retailAdapterFor(manifest)!;
    const archive = filesystemArchiveStorage(join(root, "archive"));
    const { http, calls } = fakeHttp(keellsResponder());
    const first = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http, archive, mappingBundle: bundle, captureDate: "2026-09-04" });
    assert.equal(first.status, "succeeded", first.message ?? "");
    assert.ok(first.records >= 20);
    assert.equal(first.unchanged, false);
    assert.ok(calls.some((url) => url.includes("/GuestLogin")) && calls.some((url) => url.includes("/GetItemDetails")));

    const run = database.prepare("SELECT status, workflow, parsed_count, artifact_id FROM ingest_run WHERE id = ?").get(first.runId) as { status: string; workflow: string; parsed_count: number; artifact_id: string };
    assert.deepEqual([run.status, run.workflow, run.parsed_count], ["succeeded", "retail_capture", first.records]);
    const stages = database.prepare("SELECT stage, status FROM run_stage WHERE run_id = ? ORDER BY id").all(first.runId) as Array<{ stage: string; status: string }>;
    assert.deepEqual(stages.map((stage) => stage.stage), ["fetch_snapshot", "normalize_records", "validate_records", "store_snapshot", "canonicalize_data"]);
    assert.ok(stages.every((stage) => stage.status === "succeeded"));

    const artifact = database.prepare("SELECT status, media_type, storage_ref FROM source_artifact WHERE id = ?").get(first.artifactId) as { status: string; media_type: string; storage_ref: string };
    assert.equal(artifact.status, "canonicalized");
    assert.equal(artifact.media_type, "application/json");
    assert.match(artifact.storage_ref, /snapshots\/2026\/09\//u);
    const staging = database.prepare("SELECT COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND price_type = 'retail_online_store'").get(first.artifactId) as { count: number };
    assert.equal(staging.count, first.records);

    const carrot = database
      .prepare("SELECT normalized_min_value_minor, normalized_unit, price_type, market_id FROM price_observation WHERE item_id = 'item_carrot' AND status = 'active'")
      .get() as { normalized_min_value_minor: number; normalized_unit: string; price_type: string; market_id: string };
    const carrotAmount = keellsItems.result.itemDetailResult.itemDetails.find((item) => item.name.trim() === "Carrot")!.amount;
    assert.deepEqual(carrot, { normalized_min_value_minor: Math.round(carrotAmount * 100), normalized_unit: "kg", price_type: "retail_online_store", market_id: "market_keells_online" });
    const health = database.prepare("SELECT state, consecutive_failures, paused_until, last_capture_at FROM source WHERE id = ?").get(manifest.id) as { state: string; consecutive_failures: number; paused_until: string | null; last_capture_at: string | null };
    assert.deepEqual([health.state, health.consecutive_failures, health.paused_until], ["healthy", 0, null]);
    assert.ok(health.last_capture_at);

    const second = await runRetailCapture(database, manifest, adapter, { trigger: "scheduled", http, archive, mappingBundle: bundle, captureDate: "2026-09-04" });
    assert.equal(second.status, "succeeded");
    assert.equal(second.unchanged, true);
    assert.equal(second.artifactId, first.artifactId);
    const artifacts = database.prepare("SELECT COUNT(*) AS count FROM source_artifact WHERE publication_id = (SELECT publication_id FROM source_artifact WHERE id = ?)").get(first.artifactId) as { count: number };
    assert.equal(artifacts.count, 1, "identical prices do not create a second artifact");
    const observations = database.prepare("SELECT COUNT(*) AS count FROM price_observation WHERE item_id = 'item_carrot' AND status = 'active'").get() as { count: number };
    assert.equal(observations.count, 1, "re-capture does not duplicate canonical rows");
  } finally {
    cleanup();
  }
});

test("suspicious snapshots are held for review instead of published", async () => {
  const { database, root, cleanup } = temporaryDatabase();
  try {
    const adapter = retailAdapterFor(manifest)!;
    const archive = filesystemArchiveStorage(join(root, "archive"));
    const items = keellsItems.result.itemDetailResult.itemDetails;
    const full = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http: fakeHttp(keellsResponder(items)).http, archive, mappingBundle: bundle, captureDate: "2026-09-04" });
    assert.equal(full.status, "succeeded");

    const tiny = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http: fakeHttp(keellsResponder(items.slice(0, 3))).http, archive, mappingBundle: bundle, captureDate: "2026-09-05" });
    assert.equal(tiny.status, "blocked");
    assert.equal(tiny.code, "SNAPSHOT_TOO_SMALL");

    saveAdapterSettings(database, manifest, adapter, { minimumRecords: 1 }, "tests");
    const anomaly = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http: fakeHttp(keellsResponder(items.slice(0, 3))).http, archive, mappingBundle: bundle, captureDate: "2026-09-05" });
    assert.equal(anomaly.status, "blocked");
    assert.equal(anomaly.code, "SNAPSHOT_VOLUME_ANOMALY");
    const quarantine = database.prepare("SELECT reason_code FROM quarantine WHERE run_id = ?").all(anomaly.runId) as Array<{ reason_code: string }>;
    assert.deepEqual(quarantine.map((row) => row.reason_code), ["SNAPSHOT_VOLUME_ANOMALY"]);
    const publications = database.prepare("SELECT COUNT(*) AS count FROM source_artifact artifact JOIN source_publication publication ON publication.id = artifact.publication_id WHERE publication.source_id = ? AND publication.source_publication_key = 'snapshot_2026-09-05'").get(manifest.id) as { count: number };
    assert.equal(publications.count, 0, "held snapshots are not stored as artifacts");
  } finally {
    cleanup();
  }
});

test("repeated failures pause the source until an operator resumes it", async () => {
  const { database, cleanup } = temporaryDatabase();
  try {
    const adapter = retailAdapterFor(manifest)!;
    const broken = fakeHttp(() => new Response("down", { status: 502 })).http;
    const now = new Date("2026-09-04T01:00:00.000Z");
    const first = await runRetailCapture(database, manifest, adapter, { trigger: "scheduled", http: broken, mappingBundle: bundle, now });
    assert.deepEqual([first.status, first.code], ["failed", "SOURCE_HTTP_502"]);
    let health = database.prepare("SELECT state, consecutive_failures, paused_until FROM source WHERE id = ?").get(manifest.id) as { state: string; consecutive_failures: number; paused_until: string | null };
    assert.deepEqual([health.state, health.consecutive_failures, health.paused_until], ["degraded", 1, null]);

    const second = await runRetailCapture(database, manifest, adapter, { trigger: "scheduled", http: broken, mappingBundle: bundle, now });
    assert.equal(second.status, "failed");
    health = database.prepare("SELECT state, consecutive_failures, paused_until FROM source WHERE id = ?").get(manifest.id) as typeof health;
    assert.equal(health.state, "paused");
    assert.equal(health.consecutive_failures, 2);
    assert.equal(health.paused_until, new Date(now.getTime() + 6 * 3_600_000).toISOString());

    const third = await runRetailCapture(database, manifest, adapter, { trigger: "scheduled", http: broken, mappingBundle: bundle, now });
    assert.deepEqual([third.status, third.code, third.runId], ["skipped", "CAPTURE_PAUSED", null]);

    resumeSourceCapture(database, manifest.id, "tests");
    const recovered = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http: fakeHttp(keellsResponder()).http, mappingBundle: bundle, now });
    assert.equal(recovered.status, "succeeded");
    health = database.prepare("SELECT state, consecutive_failures, paused_until FROM source WHERE id = ?").get(manifest.id) as typeof health;
    assert.deepEqual([health.state, health.consecutive_failures, health.paused_until], ["healthy", 0, null]);
    const runs = database.prepare("SELECT COUNT(*) AS count FROM ingest_run WHERE source_id = ? AND workflow = 'retail_capture'").get(manifest.id) as { count: number };
    assert.equal(runs.count, 3, "a paused source does not open a run");
  } finally {
    cleanup();
  }
});

test("invalid settings fail the run without tripping the breaker", async () => {
  const { database, cleanup } = temporaryDatabase();
  try {
    const adapter = retailAdapterFor(manifest)!;
    database.prepare("INSERT INTO source (id, manifest_json, name, owner, landing_url, rights_status, reviewed_at, review_due_at, enabled, state, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'healthy', ?)")
      .run(manifest.id, JSON.stringify(manifest), manifest.name, manifest.owner, manifest.landing_url, manifest.rights_status, manifest.reviewed_at, manifest.review_due_at, new Date().toISOString());
    database.prepare("INSERT INTO source_adapter_setting (source_id, settings_json, updated_by, updated_at) VALUES (?, ?, 'tests', ?)").run(manifest.id, JSON.stringify({ itemsPerPage: 1 }), new Date().toISOString());
    const result = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http: fakeHttp(keellsResponder()).http, mappingBundle: bundle });
    assert.deepEqual([result.status, result.code], ["failed", "SETTINGS_INVALID"]);
    const health = database.prepare("SELECT consecutive_failures FROM source WHERE id = ?").get(manifest.id) as { consecutive_failures: number };
    assert.equal(health.consecutive_failures, 0);
  } finally {
    cleanup();
  }
});
