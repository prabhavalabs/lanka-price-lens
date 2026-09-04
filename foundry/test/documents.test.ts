import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sourceManifestSchema } from "@lanka-pricelens/shared";

import { cbslDailyPriceAdapter } from "../src/documents/cbsl.ts";
import { dcsWeeklyRetailAdapter, periodFromTitle, weekCandidates } from "../src/documents/dcs.ts";
import { documentAdapterFor, documentParseCode, DocumentParseError, hartiDailyAdapter } from "../src/documents/index.ts";
import { linesOf, type DiscoveryContext } from "../src/documents/types.ts";
import type { TextItem } from "../src/pdf.ts";
import { parsePrintedNumber, parsePrintedUnit } from "../src/units.ts";

const fixturesRoot = new URL("./fixtures/documents/", import.meta.url);
const items = (name: string): TextItem[] => (JSON.parse(readFileSync(new URL(name, fixturesRoot), "utf8")) as { items: TextItem[] }).items;
const html = (name: string): string => readFileSync(new URL(name, fixturesRoot), "utf8");

const cbslManifest = sourceManifestSchema.parse({
  id: "cbsl_test",
  name: "CBSL test",
  owner: "Central Bank of Sri Lanka",
  landing_url: "https://www.cbsl.gov.lk/en/statistics/economic-indicators/price-report",
  retrieval_method: "scheduled_download",
  expected_cadence: "business_daily",
  formats: ["pdf"],
  geographic_scope: "selected_markets",
  price_types: ["wholesale_observed", "retail_observed"],
  rights_status: "internal_evaluation",
  rights_evidence_ref: "docs/official-sources.md",
  attribution_text: "Test",
  retention_policy: "preserve_source_evidence",
  parser_owner: "tests",
  reviewed_by: "tests",
  reviewed_at: "2026-09-01",
  review_due_at: "2099-01-01",
  request_interval_ms: 1000,
  max_attempts: 2,
  enabled: true,
  document_adapter: "cbsl_daily_price",
});

function discoveryContext(manifest: typeof cbslManifest, page: string, range: DiscoveryContext["range"], fetchPage: (url: string) => string | null): DiscoveryContext {
  const log: string[] = [];
  return {
    manifest,
    html: page,
    range,
    request: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const body = fetchPage(url);
      if (body === null) return new Response("missing", { status: 404 });
      const headers = { "content-type": url.endsWith(".pdf") ? "application/pdf" : "text/html" };
      return new Response(init?.method === "HEAD" ? null : body, { status: 200, headers });
    }) as typeof fetch,
    fetchWithRetry: async (url) => {
      const body = fetchPage(url);
      if (body === null) throw new Error("SOURCE_HTTP_404");
      return new Response(body, { status: 200 });
    },
    readBody: async (response) => new Uint8Array(await response.arrayBuffer()),
    log: (level, message) => { log.push(`${level}: ${message}`); },
    now: new Date("2026-09-04T03:00:00Z"),
  };
}

test("printed units and numbers from official reports are understood", () => {
  assert.deepEqual(parsePrintedUnit("Rs./kg"), { quantity: "1", unit: "kg" });
  assert.deepEqual(parsePrintedUnit("Rs./Nut"), { quantity: "1", unit: "piece" });
  assert.deepEqual(parsePrintedUnit("Rs./Ltr"), { quantity: "1", unit: "l" });
  assert.deepEqual(parsePrintedUnit("1 kg."), { quantity: "1", unit: "kg" });
  assert.deepEqual(parsePrintedUnit("1Kg.Pkt."), { quantity: "1", unit: "kg" });
  assert.deepEqual(parsePrintedUnit("750 ml"), { quantity: "750", unit: "ml" });
  assert.deepEqual(parsePrintedUnit("500g"), { quantity: "500", unit: "g" });
  assert.deepEqual(parsePrintedUnit("Bunch"), { quantity: "1", unit: "bunch" });
  assert.deepEqual(parsePrintedUnit("Each"), { quantity: "1", unit: "piece" });
  assert.deepEqual(parsePrintedUnit("100 Nuts"), { quantity: "100", unit: "piece" });
  assert.equal(parsePrintedNumber("1,600.00"), 1600);
  assert.equal(parsePrintedNumber("n.a."), null);
  assert.equal(parsePrintedNumber("-1.8%"), null);
});

test("CBSL daily price report yields today's wholesale and retail prices per market", () => {
  const parsed = cbslDailyPriceAdapter.parse(items("cbsl-daily-2026-09-03.items.json"), { title: "Daily Price Report - 03 September 2026", date: "2026-09-01" });
  assert.equal(parsed.strategy, "cbsl_wholesale_retail_table");
  assert.ok(parsed.confidence > 0.9, `confidence ${parsed.confidence}`);
  assert.ok(parsed.observations.length >= 150, `${parsed.observations.length} observations`);
  assert.ok(parsed.observations.every((observation) => observation.date === "2026-09-03"), "date comes from the table title");
  const carrot = Object.fromEntries(parsed.observations.filter((observation) => observation.itemLabel === "Carrot").map((observation) => [observation.marketLabel, [observation.priceType, observation.minValueMinor / 100]]));
  assert.deepEqual(carrot, {
    "Pettah (wholesale)": ["wholesale_observed", 200],
    "Dambulla (wholesale)": ["wholesale_observed", 155],
    "Pettah (retail)": ["retail_observed", 250],
    "Dambulla (retail)": ["retail_observed", 185],
    "Narahenpita (retail)": ["retail_observed", 360],
  });
  const coconut = parsed.observations.find((observation) => observation.itemLabel === "Coconut (Avg.)" && observation.marketLabel === "Pettah (retail)");
  assert.deepEqual(coconut && [coconut.sourceQuantity, coconut.sourceUnit, coconut.minValueMinor], ["1", "piece", 15_800]);
  const fish = parsed.observations.filter((observation) => observation.rowRef.startsWith("fish/"));
  assert.ok(fish.some((observation) => observation.marketLabel === "Peliyagoda (wholesale)" && observation.itemLabel === "Paraw" && observation.minValueMinor === 140_000));
  assert.ok(fish.every((observation) => !/pettah/iu.test(observation.marketLabel)), "fish rows use the fish section's market headings");
  const keys = new Set(parsed.observations.map((observation) => `${observation.rowRef}|${observation.marketLabel}`));
  assert.equal(keys.size, parsed.observations.length, "row reference and market are unique per observation");
});

test("DCS weekly retail report yields ranges and averages for the Colombo district", () => {
  const parsed = dcsWeeklyRetailAdapter.parse(items("dcs-weekly-2026-08-w4.items.json"), { title: "DCSB-WRP-2026-08-W4.pdf", date: "2026-08-22" });
  assert.equal(parsed.strategy, "dcs_weekly_average_table");
  assert.ok(parsed.confidence > 0.9, `confidence ${parsed.confidence}`);
  assert.ok(parsed.observations.length >= 110, `${parsed.observations.length} observations`);
  assert.ok(parsed.observations.every((observation) => observation.date === "2026-08-22" && observation.priceType === "retail_observed"));
  const byLabel = new Map(parsed.observations.map((observation) => [observation.itemLabel, observation]));
  const potato = byLabel.get("Potatoes - Imported");
  assert.deepEqual(potato && [potato.sourceQuantity, potato.sourceUnit, potato.minValueMinor, potato.maxValueMinor, (potato.raw as { average_this_week: number }).average_this_week], ["1", "kg", 20_000, 24_000, 219.2]);
  assert.ok(byLabel.has("B.Onions - Imported"), "bare qualifier rows inherit the group label");
  assert.ok(byLabel.has("Egg - White"));
  assert.ok(!byLabel.has("B.Onions - Local"), "rows without values are skipped");
  const oil = byLabel.get("Coconut Oil");
  assert.deepEqual(oil && [oil.sourceQuantity, oil.sourceUnit], ["750", "ml"]);
  const gotukola = byLabel.get("Gotukola");
  assert.deepEqual(gotukola && [gotukola.sourceUnit, gotukola.minValueMinor, gotukola.maxValueMinor], ["bunch", 4_000, 8_000]);
  assert.equal(new Set(parsed.observations.map((observation) => observation.rowRef)).size, parsed.observations.length);
});

test("DCS week periods and probe candidates follow the report naming", () => {
  assert.deepEqual(periodFromTitle("OPEN MARKET WEEKLY AVERAGE RETAIL PRICES - 4th Week of August 2026"), { week: 4, month: 8, year: 2026, date: "2026-08-22" });
  assert.deepEqual(periodFromTitle("1st Week of January 2025"), { week: 1, month: 1, year: 2025, date: "2025-01-01" });
  const candidates = weekCandidates("2026-07-20", "2026-09-04");
  assert.equal(candidates[0]?.file, "DCSB-WRP-2026-09-W1.pdf");
  assert.ok(candidates.some((candidate) => candidate.file === "DCSB-WRP-2026-08-W4.pdf" && candidate.date === "2026-08-22"));
  assert.ok(candidates.every((candidate) => candidate.date >= "2026-07-20" && candidate.date <= "2026-09-04"));
});

test("DCS discovery probes recent weeks and keeps only the reports that exist", async () => {
  const manifest = sourceManifestSchema.parse({ ...cbslManifest, id: "dcs_test", landing_url: "https://www.statistics.gov.lk/InflationAndPrices/StaticalInformation/RetailPrices", document_adapter: "dcs_weekly_retail", expected_cadence: "weekly", price_types: ["retail_observed"] });
  const existing = new Set(["DCSB-WRP-2026-08-W4.pdf", "DCSB-WRP-2026-08-W3.pdf"]);
  const publications = await dcsWeeklyRetailAdapter.discover(discoveryContext(manifest, "<html></html>", { from: "2026-08-01", to: "2026-09-04" }, (url) => (existing.has(url.split("/").at(-1) ?? "") ? "%PDF-1.4" : null)));
  assert.deepEqual(publications.map((publication) => [publication.title, publication.date]), [["DCSB-WRP-2026-08-W4.pdf", "2026-08-22"], ["DCSB-WRP-2026-08-W3.pdf", "2026-08-15"]]);
  assert.match(publications[0]!.downloadUrl, /^https:\/\/www\.statistics\.gov\.lk\/Resource\/en\/InflationAndPrices\/retail\/DCSB-WRP-2026-08-W4\.pdf$/u);
  assert.match(dcsWeeklyRetailAdapter.archiveKey(publications[0]!), /^sources\/dcs\/weekly-retail-prices\/2026\/08\/2026-08-22\/DCSB-WRP-2026-08-W4\.pdf$/u);
});

test("CBSL discovery reads the listing page and walks older pages only as far as the range needs", async () => {
  const listing = html("cbsl-listing.html");
  let olderPages = 0;
  const context = discoveryContext(cbslManifest, listing, {}, (url) => { olderPages += 1; return url.includes("page=") ? "<html></html>" : listing; });
  const latest = await cbslDailyPriceAdapter.discover(context);
  assert.ok(latest.length >= 10);
  assert.equal(latest[0]?.date, "2026-09-03");
  assert.equal(latest[0]?.title, "Daily Price Report - 03 September 2026");
  assert.equal(olderPages, 0, "no range means no paging");
  assert.equal(cbslDailyPriceAdapter.archiveKey(latest[0]!), "sources/cbsl/daily-price-report/2026/09/2026-09-03/Daily-Price-Report---03-September-2026");

  const ranged = await cbslDailyPriceAdapter.discover(discoveryContext(cbslManifest, listing, { from: "2026-08-01", to: "2026-08-31" }, (url) => (url.includes("page=") ? "<html></html>" : listing)));
  assert.ok(ranged.every((publication) => publication.date >= "2026-08-01" && publication.date <= "2026-08-31"));
});

test("adapters resolve from manifests and parse failures carry quarantine codes", () => {
  assert.equal(documentAdapterFor({ document_adapter: "harti_daily" }).kind, "harti_daily");
  assert.equal(documentAdapterFor(cbslManifest).kind, "cbsl_daily_price");
  assert.equal(hartiDailyAdapter.parserVersion, "harti-adaptive@2");
  assert.throws(() => cbslDailyPriceAdapter.parse(items("dcs-weekly-2026-08-w4.items.json"), { title: "x", date: "2026-08-22" }), (error: unknown) => error instanceof DocumentParseError && error.code === "UNSUPPORTED_DOCUMENT");
  assert.equal(documentParseCode(new DocumentParseError("SOURCE_TEMPLATE_CHANGED", "x")), "SOURCE_TEMPLATE_CHANGED");
  assert.equal(documentParseCode(new Error("boom")), null);
  const lines = linesOf([{ page: 1, index: 0, text: "b", x: 50, y: 100, width: 5, height: 5 }, { page: 1, index: 1, text: "a", x: 10, y: 101, width: 5, height: 5 }] as TextItem[]);
  assert.deepEqual(lines.map((line) => line.cells.map((cell) => cell.text)), [["a", "b"]]);
});
