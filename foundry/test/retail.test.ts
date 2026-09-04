import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mappingBundleSchema, sourceManifestSchema } from "@lanka-pricelens/shared";

import { filesystemArchiveStorage } from "../src/archive-storage.ts";
import { openOperationalDatabase, type OperationalDatabase } from "../src/db.ts";
import { cargillsAdapter, cargillsPack } from "../src/retail/adapters/cargills.ts";
import { discoverGlomarkCategories, extractGlomarkProducts, glomarkAdapter, glomarkPack } from "../src/retail/adapters/glomark.ts";
import { keellsAdapter, keellsPack } from "../src/retail/adapters/keells.ts";
import { outletCode, sparAdapter, sparLabel, sparPack } from "../src/retail/adapters/spar.ts";
import { pauseHours } from "../src/retail/capture.ts";
import { remapRecentSnapshots } from "../src/retail/remap.ts";
import { bundleFingerprint } from "../src/mapping.ts";
import { matchItemPattern } from "../src/patterns.ts";
import { countFromLabel, normalizeUnit } from "../src/units.ts";
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
import { categoryAllowed, compilePattern } from "../src/retail/settings.ts";
import { packFromLabel, priceToMinor } from "../src/retail/types.ts";
import { applicableWorkflowDefinitions, ensureWorkflowSchedules } from "../src/workflows.ts";

const fixturesRoot = new URL("./fixtures/retail/", import.meta.url);
const fixture = (name: string): string => readFileSync(new URL(name, fixturesRoot), "utf8");

const keellsItems = JSON.parse(fixture("keells-items.json")) as { result: { itemDetailResult: { itemDetails: Array<{ name: string; amount: number; uom: string; isAvailable: boolean; departmentCode?: string; subDepartmentCode?: string }> } } };
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
    { id: "product_egg", category: "other", canonical_label_en: "Egg", canonical_label_si: null, canonical_label_ta: null },
    { id: "product_chicken", category: "meat", canonical_label_en: "Chicken", canonical_label_si: null, canonical_label_ta: null },
  ],
  items: [
    { id: "item_carrot", product_id: "product_carrot", entity_type: "commodity", canonical_label_en: "Carrot", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_labels: ["Carrot"], expected_market_labels: ["Keells Online"] },
    { id: "item_big_onion", product_id: "product_big_onion", entity_type: "commodity", canonical_label_en: "Big Onion", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_labels: ["Big Onions"], expected_market_labels: ["Keells Online"] },
    // Branded, pack-sized labels are mapped by pattern: eggs are counted, whole chicken must weigh at least 800 g and be skin on.
    { id: "item_egg", product_id: "product_egg", entity_type: "commodity", canonical_label_en: "Egg", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_patterns: [{ match: "\\beggs?\\b", exclude: ["mayonnaise"], units: ["piece"], pack: "count" }], expected_market_labels: ["Keells Online"] },
    { id: "item_chicken", product_id: "product_chicken", entity_type: "commodity", canonical_label_en: "Chicken", canonical_label_si: null, canonical_label_ta: null, variety: null, grade: null, source_patterns: [{ match: "^(?=.*\\bwhole\\b)(?=.*\\bchicken\\b)", exclude: ["skinless"], units: ["kg", "g"], min_quantity: 0.8 }], expected_market_labels: ["Keells Online"] },
  ],
  excluded_patterns: ["sausage"],
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
      assert.match(url, /departmentId=&/u, "whole-catalogue listing leaves the department blank");
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
  assert.deepEqual(sparPack("GL / 500", "PUMPKIN"), { quantity: "500", unit: "g" });
  assert.deepEqual(sparPack("Default Title", "Papaya, each (about 1.2kg)"), { quantity: "1", unit: "piece" });
  assert.deepEqual(sparPack("KY", "SPAR Steamed Basmathi Rice, 1Kg"), { quantity: "1", unit: "kg" });
  assert.equal(outletCode("WT / 1000"), "WT");
  assert.equal(outletCode("GP"), "GP");
  assert.equal(outletCode("Default Title"), null);
  assert.deepEqual(sparPack("Default Title", "Anchor Milk Powder 400g"), { quantity: "400", unit: "g" });
  assert.deepEqual(sparPack("Default Title", "Mystery Pack", 250), { quantity: "250", unit: "g" });
  assert.equal(sparLabel("Coca Cola", "1.5L"), "Coca Cola 1.5L");
  assert.equal(sparLabel("CARROTS", "WT / 1000"), "CARROTS");
  assert.equal(sparLabel("SUDU NELUM Soya Bean Curd - Tofu, 300g", "GL"), "SUDU NELUM Soya Bean Curd - Tofu, 300g");
  assert.deepEqual(keellsPack("KG", "Carrot"), { quantity: "1", unit: "kg" });
  assert.deepEqual(keellsPack("NO", "Basil Leaves 50g"), { quantity: "50", unit: "g" });
  assert.deepEqual(keellsPack("NO", "Coconut"), { quantity: "1", unit: "piece" });
  assert.deepEqual(cargillsPack(500, "g"), { quantity: "500", unit: "g" });
  assert.deepEqual(cargillsPack("3.0", "pcs"), { quantity: "3", unit: "piece" });
  assert.deepEqual(cargillsPack(null, null, "Munchee Cream Cracker 190g"), { quantity: "190", unit: "g" });
  assert.deepEqual(glomarkPack("g", 100, "Chinese Cabbage"), { quantity: "100", unit: "g" });
  assert.deepEqual(glomarkPack("unit", 1, "Aigrow Butter Head Lettuce 110G"), { quantity: "110", unit: "g" });
  assert.deepEqual(glomarkPack("unit", 1, "Karapincha"), { quantity: "1", unit: "piece" });
  assert.deepEqual(packFromLabel("Myco Farm Abalone Mushroom 200G"), { quantity: "200", unit: "g" });
  assert.equal(priceToMinor("1,345.00"), 134_500);
  assert.equal(priceToMinor(157.5), 15_750);
  assert.equal(pauseHours(0), 6);
  assert.equal(pauseHours(2), 24);
  assert.equal(pauseHours(9), 48);
  assert.ok(categoryAllowed("Vegetables", compilePattern("^(Vegetables|Fruits)$"), null));
  assert.ok(!categoryAllowed("Dairy", compilePattern("^(Vegetables|Fruits)$"), null));
  assert.ok(!categoryAllowed("Baby Products", null, compilePattern("baby")));
  assert.equal(compilePattern("("), null, "invalid patterns compile to null");
});

test("adapters normalise captured payloads into the unified record shape", () => {
  const sparProducts = (JSON.parse(fixture("spar-vegetables.json")) as { products: unknown[] }).products;
  const spar = sparAdapter.normalize({ fetchedAt: "2026-09-04T01:00:00.000Z", requests: 1, data: { feeds: [{ handle: null, pages: 1, truncated: false, products: sparProducts }] } }, sparAdapter.settingsSchema.parse({}), "2026-09-04");
  const carrots = spar.find((record) => record.itemLabel === "CARROTS");
  assert.ok(carrots);
  assert.deepEqual([carrots.sourceQuantity, carrots.sourceUnit, carrots.minValueMinor, carrots.marketLabel], ["1000", "g", 36_000, "SPAR Online"]);
  assert.equal(spar.find((record) => record.itemLabel === "GARLIC")?.sourceUnit, "kg");
  assert.equal(new Set(spar.map((record) => record.rowRef)).size, spar.length);
  assert.ok(spar.every((record) => record.raw.outlet_code === "WT"), "only the first outlet's variants are kept by default");
  const everyOutlet = sparAdapter.normalize({ fetchedAt: "", requests: 1, data: { feeds: [{ handle: null, pages: 1, truncated: false, products: sparProducts }] } }, sparAdapter.settingsSchema.parse({ outletVariants: "all" }), "2026-09-04");
  assert.ok(everyOutlet.length > spar.length * 5, "outletVariants=all keeps every outlet");
  const onlyFruit = sparAdapter.normalize({ fetchedAt: "", requests: 1, data: { feeds: [{ handle: null, pages: 1, truncated: false, products: sparProducts }] } }, sparAdapter.settingsSchema.parse({ includeProductTypes: "^Fruits$" }), "2026-09-04");
  assert.equal(onlyFruit.length, 0, "vegetable fixture has no fruit product types");

  const keellsRaw = keellsItems.result.itemDetailResult.itemDetails;
  const keells = keellsAdapter.normalize({ fetchedAt: "", requests: 1, data: { departments: [{ departmentId: null, pages: 1, truncated: false, items: keellsRaw }] } }, keellsAdapter.settingsSchema.parse({ includeUnavailable: true }), "2026-09-04");
  const carrot = keells.find((record) => record.itemLabel === "Carrot");
  assert.ok(carrot);
  assert.equal(carrot.sourceUnit, "kg");
  assert.equal(carrot.minValueMinor, priceToMinor(keellsRaw.find((item) => item.name.trim() === "Carrot")!.amount));
  assert.ok(keells.every((record) => record.itemLabel === record.itemLabel.trim()), "labels are trimmed");
  const excluded = keellsAdapter.normalize({ fetchedAt: "", requests: 1, data: { departments: [{ departmentId: null, pages: 1, truncated: false, items: keellsRaw }] } }, keellsAdapter.settingsSchema.parse({ includeUnavailable: true, excludeDepartments: "^V/" }), "2026-09-04");
  assert.ok(excluded.length < keells.length, "department patterns filter records");

  const cargills = cargillsAdapter.normalize({ fetchedAt: "", requests: 1, data: { categories: [{ categoryId: "MjM=", name: "Vegetables", pages: 1, truncated: false, items: JSON.parse(fixture("cargills-items.json")) }] } }, cargillsAdapter.settingsSchema.parse({}), "2026-09-04");
  const cargillsCarrot = cargills.find((record) => record.itemLabel === "Carrot");
  assert.ok(cargillsCarrot);
  assert.deepEqual([cargillsCarrot.sourceQuantity, cargillsCarrot.sourceUnit, cargillsCarrot.minValueMinor, cargillsCarrot.raw.category], ["500", "g", 18_000, "Vegetables"]);
  assert.equal(cargills.find((record) => record.itemLabel === "Coconut")?.sourceUnit, "piece");

  const glomarkProducts = extractGlomarkProducts(fixture("glomark-category.html"));
  assert.ok(glomarkProducts && glomarkProducts.length === 30, "embedded product list is read with bracket matching");
  assert.equal(extractGlomarkProducts("<html><script>let productList = []; productCount = productList.length;</script></html>")?.length, 0);
  assert.equal(extractGlomarkProducts("<html><script>let productList = [];</script>throttled</html>"), null, "a page without the category script is unreadable, not empty");
  assert.equal(extractGlomarkProducts("<html>no list here</html>"), null);
  const glomark = glomarkAdapter.normalize({ fetchedAt: "", requests: 1, data: { discovered: 1, pages: [{ path: "/fresh/vegetable/c/145", products: glomarkProducts! }] } }, glomarkAdapter.settingsSchema.parse({}), "2026-09-04");
  const cabbage = glomark.find((record) => record.itemLabel === "Chinese Cabbage");
  assert.deepEqual(cabbage && [cabbage.sourceQuantity, cabbage.sourceUnit, cabbage.minValueMinor, cabbage.raw.category], ["100", "g", 9_000, "Fresh > Exotic Vegetable"]);
  const categories = discoverGlomarkCategories(fixture("glomark-home.html"));
  assert.ok(categories.length >= 100 && categories.includes("/fresh/vegetable/c/145") && categories.every((path) => /\/c\/\d+$/u.test(path)));
  assert.deepEqual(discoverGlomarkCategories('<a href="/Beverages/Malt/c/573">x</a><a href="/beverages/malt/c/573">y</a><a href="/Beverages/Milk%2520Foods/c/129">z</a>'), ["/Beverages/Milk%2520Foods/c/129", "/beverages/malt/c/573"], "one path per category id, plain lower-case preferred");
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
    assert.throws(() => saveAdapterSettings(database, manifest, adapter, { includeDepartments: "(" }, "tests"), /valid regular expression/u);
    saveAdapterSettings(database, manifest, adapter, { minimumRecords: 3, outletCode: "KOTT" }, "tests");
    const after = resolveAdapterSettings(database, manifest, adapter) as unknown as { minimumRecords: number; outletCode: string; maxAttempts: number };
    assert.deepEqual([after.minimumRecords, after.outletCode, after.maxAttempts], [3, "KOTT", 1]);
    const schema = settingsJsonSchema(adapter) as { properties: Record<string, { description?: string }> };
    assert.ok(schema.properties.departmentIds);
    assert.ok(schema.properties.includeDepartments?.description);
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

test("capture stores a snapshot once, promotes mapped prices, records unmapped labels, and dedupes identical re-captures", async () => {
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
    const staging = database.prepare("SELECT status, COUNT(*) AS count FROM staging_observation WHERE artifact_id = ? AND price_type = 'retail_online_store' GROUP BY status").all(first.artifactId) as Array<{ status: string; count: number }>;
    assert.equal(staging.reduce((sum, row) => sum + row.count, 0), first.records);
    assert.ok(staging.some((row) => row.status === "unmapped"), "labels without a mapping stay in staging as unmapped");
    const quarantined = database.prepare("SELECT COUNT(*) AS count FROM quarantine WHERE run_id = ?").get(first.runId) as { count: number };
    assert.equal(quarantined.count, 0, "unknown labels are recorded, not quarantined row by row");
    const unmapped = database.prepare("SELECT label, occurrences FROM source_unmapped_label WHERE source_id = ? AND label_type = 'item' ORDER BY label").all(manifest.id) as Array<{ label: string; occurrences: number }>;
    assert.ok(unmapped.length >= 10 && unmapped.every((row) => row.occurrences === 1));
    assert.ok(!unmapped.some((row) => row.label === "Carrot"));
    assert.ok(!unmapped.some((row) => row.label === "Bairaha Whole Chicken" || row.label === "Happy Hen Brown Eggs Large 10S"), "pattern-mapped labels are not waiting for a mapping");
    assert.ok(unmapped.some((row) => row.label === "Bairaha Chicken Sausages 500g"), "bundle-wide exclusions keep processed foods out");
    assert.ok(unmapped.some((row) => row.label === "Bairaha Whole Chicken Skinless"), "rule exclusions keep other forms out");
    const eggs = database.prepare("SELECT source_quantity, source_unit, normalized_min_value_minor, normalized_unit FROM price_observation WHERE item_id = 'item_egg' AND status = 'active'").all();
    assert.deepEqual(eggs, [{ source_quantity: "10", source_unit: "piece", normalized_min_value_minor: 6100, normalized_unit: "piece" }], "a tray of ten is priced per egg");
    const chicken = database.prepare("SELECT normalized_min_value_minor, normalized_unit FROM price_observation WHERE item_id = 'item_chicken' AND status = 'active'").all();
    assert.deepEqual(chicken, [{ normalized_min_value_minor: 135000, normalized_unit: "kg" }]);
    const derived = database.prepare("SELECT source_label, item_id FROM source_item_mapping WHERE source_id = ? AND origin = 'pattern' ORDER BY source_label").all(manifest.id);
    assert.deepEqual(derived, [{ source_label: "Bairaha Whole Chicken", item_id: "item_chicken" }, { source_label: "Happy Hen Brown Eggs Large 10S", item_id: "item_egg" }], "pattern matches are recorded as mappings for search and audit");

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
    const stillOnce = database.prepare("SELECT MAX(occurrences) AS most FROM source_unmapped_label WHERE source_id = ?").get(manifest.id) as { most: number };
    assert.equal(stillOnce.most, 1, "an unchanged snapshot does not count labels again");
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

test("count packs and pattern rules read branded labels", () => {
  assert.equal(countFromLabel("Happy Hen Brown Eggs Large 10S"), 10);
  assert.equal(countFromLabel("Happy Hen Eggs 30S' (1.890Kg)"), 30);
  assert.equal(countFromLabel("Besto Pre Cut Whole Chicken(12Pcs)"), 12);
  assert.equal(countFromLabel("Nel Farm Brown Egg Large 6S"), 6);
  assert.equal(countFromLabel("NEL FARMS Egg Large, 10's"), 10);
  assert.equal(countFromLabel("Dettol Soap Pack of 3"), 3);
  assert.equal(countFromLabel("SPAR LOCAL Eggs - Medium, 10 Pack"), 10);
  assert.equal(countFromLabel("Cic Besto Eggs Omega 3 Standard 10S"), 10, "a digit followed by a word is not a count");
  assert.equal(countFromLabel("Anchor Milk Powder 400g"), null);
  assert.equal(countFromLabel("Coca Cola 1.5L"), null);
  assert.equal(countFromLabel("Kandos 21 Collection Milk Chocolate"), null);
  assert.deepEqual(packFromLabel("Lakmo Eggs Medium 10S"), { quantity: "10", unit: "piece" });
  assert.deepEqual(packFromLabel("Keells Arabic Bread 500G 5S"), { quantity: "500", unit: "g" }, "a printed weight still wins over a count");
  assert.equal(normalizeUnit("S"), "piece");

  const tray = matchItemPattern(bundle, "Happy Hen Eggs 30S' (1.890Kg)", "1.89", "kg");
  assert.deepEqual([tray?.itemId, tray?.quantity, tray?.unit], ["item_egg", "30", "piece"], "a count rule re-reads a weighed tray as pieces");
  assert.equal(matchItemPattern(bundle, "Edinborough Egg Mayonnaise 360g", "360", "g"), null, "rule exclusions");
  assert.equal(matchItemPattern(bundle, "Bairaha Chicken Sausages 500g", "500", "g"), null, "bundle-wide exclusions");
  assert.equal(matchItemPattern(bundle, "Bairaha Whole Chicken Skinless", "1", "kg"), null);
  assert.equal(matchItemPattern(bundle, "CIC Whole Chicken", "300", "g"), null, "below the minimum pack");
  assert.equal(matchItemPattern(bundle, "CIC Whole Chicken", "1300", "g")?.itemId, "item_chicken");
  assert.equal(matchItemPattern(bundle, "Prima Whole Chicken", "1", "piece"), null, "unit the rule does not accept");
  assert.equal(matchItemPattern(bundle, "Carrot", "1", "kg"), null, "exact labels are not the pattern engine's business");
});

test("an unchanged re-capture and remap promote rows a newer bundle maps", async () => {
  const { database, root, cleanup } = temporaryDatabase();
  try {
    const adapter = retailAdapterFor(manifest)!;
    const archive = filesystemArchiveStorage(join(root, "archive"));
    const { http } = fakeHttp(keellsResponder());
    const first = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http, archive, mappingBundle: bundle, captureDate: "2026-09-04" });
    assert.equal(first.status, "succeeded", first.message ?? "");
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM price_observation WHERE item_id = 'item_chicken_whole_skinless'").get(), { count: 0 });

    const skinless = { id: "item_chicken_whole_skinless", product_id: "product_chicken", entity_type: "variety", canonical_label_en: "Chicken", canonical_label_si: null, canonical_label_ta: null, variety: "Whole, skinless", grade: null, source_patterns: [{ match: "^(?=.*\\bwhole\\b)(?=.*\\bchicken\\b)(?=.*skinless)", units: ["kg", "g"], min_quantity: 0.8 }], expected_market_labels: ["Keells Online"] };
    const wider = mappingBundleSchema.parse({ ...bundle, mapping_version: "keells-test.2", items: [...bundle.items, skinless] });
    const second = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http, archive, mappingBundle: wider, captureDate: "2026-09-04" });
    assert.deepEqual([second.status, second.unchanged, second.artifactId], ["succeeded", true, first.artifactId]);
    const promoted = database.prepare("SELECT normalized_min_value_minor FROM price_observation WHERE item_id = 'item_chicken_whole_skinless' AND status = 'active'").all();
    assert.deepEqual(promoted, [{ normalized_min_value_minor: 145000 }], "the stored snapshot is promoted under the wider bundle");
    const artifact = database.prepare("SELECT mapping_version FROM source_artifact WHERE id = ?").get(first.artifactId) as { mapping_version: string };
    assert.equal(artifact.mapping_version, "keells-test.2");
    const carrots = database.prepare("SELECT COUNT(*) AS count FROM price_observation WHERE item_id = 'item_carrot' AND status = 'active'").get() as { count: number };
    assert.equal(carrots.count, 1, "rows already promoted are corrected in place, not duplicated");
    const stillOnce = database.prepare("SELECT MAX(occurrences) AS most FROM source_unmapped_label WHERE source_id = ?").get(manifest.id) as { most: number };
    assert.equal(stillOnce.most, 2, "the re-promotion counts the labels still waiting once more");

    const nothing = await remapRecentSnapshots(database, manifest, adapter, wider, { days: 7, now: new Date("2026-09-05T00:00:00Z") });
    assert.equal(nothing.status, "skipped");
    const forced = await remapRecentSnapshots(database, manifest, adapter, wider, { days: 7, now: new Date("2026-09-05T00:00:00Z"), force: true });
    assert.deepEqual([forced.status, forced.artifacts], ["succeeded", 1]);
    const runs = database.prepare("SELECT COUNT(*) AS count FROM ingest_run WHERE source_id = ? AND status = 'succeeded'").get(manifest.id) as { count: number };
    assert.equal(runs.count, 3, "a remap is its own audited run");

    // A bundle that stops mapping eggs retires the egg prices and puts the label back in the waiting list.
    const narrower = mappingBundleSchema.parse({ ...wider, mapping_version: "keells-test.3", items: wider.items.filter((item) => item.id !== "item_egg") });
    const third = await runRetailCapture(database, manifest, adapter, { trigger: "manual", http, archive, mappingBundle: narrower, captureDate: "2026-09-04" });
    assert.deepEqual([third.status, third.unchanged], ["succeeded", true]);
    const eggStatuses = database.prepare("SELECT status, revision_reason FROM price_observation WHERE item_id = 'item_egg' ORDER BY created_at").all();
    assert.deepEqual(eggStatuses, [{ status: "superseded", revision_reason: "mapping_or_parser_correction" }]);
    assert.ok(database.prepare("SELECT 1 FROM source_unmapped_label WHERE source_id = ? AND label = 'Happy Hen Brown Eggs Large 10S'").get(manifest.id));
    assert.deepEqual(database.prepare("SELECT COUNT(*) AS count FROM source_item_mapping WHERE source_id = ? AND source_label = 'Happy Hen Brown Eggs Large 10S'").get(manifest.id), { count: 0 }, "the derived mapping is dropped with the rule");
  } finally {
    cleanup();
  }
});

test("bundle fingerprints ignore empty pattern fields so earlier registrations stay valid", () => {
  const plain = mappingBundleSchema.parse({ ...bundle, mapping_version: "keells-test.plain", excluded_patterns: [], items: bundle.items.filter((item) => !item.source_patterns.length) });
  const legacy = JSON.parse(JSON.stringify(plain)) as { excluded_patterns?: unknown; items: Array<{ source_patterns?: unknown }>; products: Array<{ comparison?: unknown }> };
  delete legacy.excluded_patterns;
  for (const item of legacy.items) delete item.source_patterns;
  for (const product of legacy.products) delete product.comparison;
  assert.equal(bundleFingerprint(plain), createHash("sha256").update(JSON.stringify(legacy)).digest("hex"), "a bundle without rules hashes as it did before rules existed");
  assert.notEqual(bundleFingerprint(bundle), bundleFingerprint(plain), "rules are part of the fingerprint");
});
