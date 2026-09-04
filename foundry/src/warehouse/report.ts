import type { WarehouseClient } from "./client.ts";

export type WarehouseReport = {
  generated_at: string;
  totals: { observations: number; active: number; items: number; products: number; markets: number; sources: number; publications: number; first_day: string | null; last_day: string | null };
  sources: Array<{ source_id: string; name: string; kind: string; rights_status: string; cadence: string | null; observations: number; active: number; items: number; markets: number; first_day: string | null; last_day: string | null; days: number; last_7_days: number }>;
  markets: Array<{ market_id: string; label: string; type: string; price_type: string; active: number; items: number; last_day: string | null }>;
  checks: {
    duplicate_active_effective_keys: number;
    active_rows_missing_effective_key: number;
    superseded_without_successor: number;
    orphan_publications: number;
    units_per_item: Array<{ item_id: string; units: string[] }>;
    extreme_prices: Array<{ item_id: string; market_id: string; observed_on: string; price_type: string; per_unit: number; unit: string; source_id: string }>;
    stale_sources: Array<{ source_id: string; last_day: string | null; days_stale: number }>;
  };
  staples: Array<{ item_id: string; label: string; markets: Array<{ market_id: string; price_type: string; observed_on: string; mid: number; unit: string }> }>;
};

const staples = [
  "item_carrot", "item_beans", "item_tomato", "item_big_onion", "item_big_onion_imported", "item_red_onion", "item_potato", "item_potato_imported", "item_cabbage",
  "item_green_chillies", "item_pumpkin", "item_coconut", "item_rice_nadu", "item_rice_samba", "item_red_dhal", "item_sugar_white", "item_egg", "item_chicken",
];

export async function warehouseReport(client: WarehouseClient, today = new Date()): Promise<WarehouseReport> {
  const todayIso = today.toISOString().slice(0, 10);
  const [totals] = await client.query<{ observations: string; active: string; items: string; products: string; markets: string; sources: string; publications: string; first_day: string | null; last_day: string | null }>(
    `SELECT (SELECT COUNT(*) FROM price_observation) AS observations,
            (SELECT COUNT(*) FROM price_observation WHERE status = 'active') AS active,
            (SELECT COUNT(*) FROM item) AS items, (SELECT COUNT(*) FROM product) AS products,
            (SELECT COUNT(*) FROM market) AS markets, (SELECT COUNT(*) FROM source) AS sources,
            (SELECT COUNT(*) FROM publication) AS publications,
            (SELECT MIN(observed_on)::TEXT FROM price_observation WHERE status = 'active') AS first_day,
            (SELECT MAX(observed_on)::TEXT FROM price_observation WHERE status = 'active') AS last_day`,
  );
  const sources = await client.query<WarehouseReport["sources"][number]>(
    `SELECT source.id AS source_id, source.name, source.kind, source.rights_status, source.cadence,
            COUNT(observation.id)::INTEGER AS observations,
            COUNT(observation.id) FILTER (WHERE observation.status = 'active')::INTEGER AS active,
            COUNT(DISTINCT observation.item_id) FILTER (WHERE observation.status = 'active')::INTEGER AS items,
            COUNT(DISTINCT observation.market_id) FILTER (WHERE observation.status = 'active')::INTEGER AS markets,
            MIN(observation.observed_on) FILTER (WHERE observation.status = 'active')::TEXT AS first_day,
            MAX(observation.observed_on) FILTER (WHERE observation.status = 'active')::TEXT AS last_day,
            COUNT(DISTINCT observation.observed_on) FILTER (WHERE observation.status = 'active')::INTEGER AS days,
            COUNT(DISTINCT observation.observed_on) FILTER (WHERE observation.status = 'active' AND observation.observed_on >= $1::DATE - 6)::INTEGER AS last_7_days
     FROM source LEFT JOIN price_observation observation ON observation.source_id = source.id
     GROUP BY source.id, source.name, source.kind, source.rights_status, source.cadence ORDER BY source.kind, source.id`,
    [todayIso],
  );
  const markets = await client.query<WarehouseReport["markets"][number]>(
    `SELECT market.id AS market_id, market.label_en AS label, market.type, observation.price_type,
            COUNT(*)::INTEGER AS active, COUNT(DISTINCT observation.item_id)::INTEGER AS items, MAX(observation.observed_on)::TEXT AS last_day
     FROM price_observation observation JOIN market ON market.id = observation.market_id
     WHERE observation.status = 'active'
     GROUP BY market.id, market.label_en, market.type, observation.price_type ORDER BY market.type, market.label_en, observation.price_type`,
  );
  const [duplicates] = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM (SELECT effective_key FROM price_observation WHERE status = 'active' AND effective_key IS NOT NULL GROUP BY effective_key HAVING COUNT(*) > 1) duplicated`,
  );
  const [missingKeys] = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM price_observation WHERE status = 'active' AND effective_key IS NULL`);
  const [supersededDangling] = await client.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM price_observation old WHERE old.status = 'superseded' AND old.superseded_by_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM price_observation new WHERE new.id = old.superseded_by_id)`,
  );
  const [orphans] = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM publication WHERE NOT EXISTS (SELECT 1 FROM source WHERE source.id = publication.source_id)`);
  const unitsPerItem = await client.query<{ item_id: string; units: string[] }>(
    `SELECT item_id, ARRAY_AGG(DISTINCT normalized_unit ORDER BY normalized_unit) AS units FROM price_observation WHERE status = 'active' GROUP BY item_id HAVING COUNT(DISTINCT normalized_unit) > 1 ORDER BY item_id LIMIT 50`,
  );
  const extremes = await client.query<WarehouseReport["checks"]["extreme_prices"][number]>(
    `SELECT item_id, market_id, observed_on::TEXT, price_type, (mid_value_minor / 100.0)::FLOAT AS per_unit, normalized_unit AS unit, source_id
     FROM price_observation WHERE status = 'active' AND normalized_unit = 'kg' AND (mid_value_minor > 2000000 OR mid_value_minor < 1000)
     ORDER BY mid_value_minor DESC LIMIT 20`,
  );
  // A source is stale when it has been quiet for longer than its cadence allows (weekly reports lag by design).
  const allowance = (cadence: string | null): number => (cadence === "weekly" ? 10 : cadence === "business_daily" ? 4 : 3);
  const stale = sources
    .map((source) => ({ source_id: source.source_id, last_day: source.last_day, days_stale: source.last_day ? Math.round((Date.parse(todayIso) - Date.parse(source.last_day)) / 86_400_000) : Number.POSITIVE_INFINITY }))
    .filter((source) => source.days_stale > allowance(sources.find((candidate) => candidate.source_id === source.source_id)?.cadence ?? null));
  const stapleRows = await client.query<{ item_id: string; label: string; market_id: string; price_type: string; observed_on: string; mid: string; unit: string }>(
    `SELECT latest.item_id, item.label_en AS label, latest.market_id, latest.price_type, latest.observed_on::TEXT, (latest.mid_minor / 100.0)::TEXT AS mid, latest.normalized_unit AS unit
     FROM latest_item_price latest JOIN item ON item.id = latest.item_id
     WHERE latest.item_id = ANY($1::TEXT[]) ORDER BY latest.item_id, latest.price_type, latest.market_id`,
    [staples],
  );
  const byItem = new Map<string, WarehouseReport["staples"][number]>();
  for (const row of stapleRows) {
    const entry = byItem.get(row.item_id) ?? { item_id: row.item_id, label: row.label, markets: [] };
    entry.markets.push({ market_id: row.market_id, price_type: row.price_type, observed_on: row.observed_on, mid: Number(row.mid), unit: row.unit });
    byItem.set(row.item_id, entry);
  }
  return {
    generated_at: today.toISOString(),
    totals: {
      observations: Number(totals!.observations),
      active: Number(totals!.active),
      items: Number(totals!.items),
      products: Number(totals!.products),
      markets: Number(totals!.markets),
      sources: Number(totals!.sources),
      publications: Number(totals!.publications),
      first_day: totals!.first_day,
      last_day: totals!.last_day,
    },
    sources: sources.map((source) => ({ ...source, observations: Number(source.observations), active: Number(source.active), items: Number(source.items), markets: Number(source.markets), days: Number(source.days), last_7_days: Number(source.last_7_days) })),
    markets: markets.map((market) => ({ ...market, active: Number(market.active), items: Number(market.items) })),
    checks: {
      duplicate_active_effective_keys: Number(duplicates!.count),
      active_rows_missing_effective_key: Number(missingKeys!.count),
      superseded_without_successor: Number(supersededDangling!.count),
      orphan_publications: Number(orphans!.count),
      units_per_item: unitsPerItem,
      extreme_prices: extremes,
      stale_sources: stale.map((source) => ({ ...source, days_stale: Number.isFinite(source.days_stale) ? source.days_stale : 9999 })),
    },
    staples: [...byItem.values()],
  };
}

export function renderReportMarkdown(report: WarehouseReport): string {
  const lines: string[] = [];
  lines.push(`# Warehouse validation report`, ``, `Generated ${report.generated_at}`, ``);
  lines.push(`## Totals`, ``, `| Observations | Active | Items | Products | Markets | Sources | Publications | First day | Last day |`, `| --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  const t = report.totals;
  lines.push(`| ${t.observations} | ${t.active} | ${t.items} | ${t.products} | ${t.markets} | ${t.sources} | ${t.publications} | ${t.first_day ?? "-"} | ${t.last_day ?? "-"} |`, ``);
  lines.push(`## Sources`, ``, `| Source | Kind | Rights | Active rows | Items | Markets | First | Last | Days | Days in last 7 |`, `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const source of report.sources) lines.push(`| ${source.source_id} | ${source.kind} | ${source.rights_status} | ${source.active} | ${source.items} | ${source.markets} | ${source.first_day ?? "-"} | ${source.last_day ?? "-"} | ${source.days} | ${source.last_7_days} |`);
  lines.push(``, `## Markets`, ``, `| Market | Type | Price type | Active rows | Items | Last day |`, `| --- | --- | --- | --- | --- | --- |`);
  for (const market of report.markets) lines.push(`| ${market.label} | ${market.type} | ${market.price_type} | ${market.active} | ${market.items} | ${market.last_day ?? "-"} |`);
  const c = report.checks;
  lines.push(``, `## Integrity checks`, ``, `- Duplicate active effective keys: ${c.duplicate_active_effective_keys}`, `- Active rows without an effective key: ${c.active_rows_missing_effective_key}`, `- Superseded rows whose successor is missing: ${c.superseded_without_successor}`, `- Publications without a source: ${c.orphan_publications}`, `- Items priced in more than one unit: ${c.units_per_item.length}${c.units_per_item.length ? ` (${c.units_per_item.slice(0, 8).map((row) => `${row.item_id}: ${row.units.join("/")}`).join("; ")})` : ""}`, `- Stale sources (quiet for longer than their cadence allows): ${c.stale_sources.length ? c.stale_sources.map((source) => `${source.source_id} (${source.days_stale} days)`).join(", ") : "none"}`);
  if (c.extreme_prices.length) {
    lines.push(``, `### Prices outside the plausible per-kilogram range`, ``, `| Item | Market | Day | Price type | Rs per kg | Source |`, `| --- | --- | --- | --- | --- | --- |`);
    for (const row of c.extreme_prices) lines.push(`| ${row.item_id} | ${row.market_id} | ${row.observed_on} | ${row.price_type} | ${row.per_unit} | ${row.source_id} |`);
  }
  lines.push(``, `## Staples across markets (latest price)`, ``);
  for (const staple of report.staples) {
    lines.push(`### ${staple.label} (${staple.item_id})`, ``, `| Market | Price type | Day | Rs per unit | Unit |`, `| --- | --- | --- | --- | --- |`);
    for (const market of staple.markets) lines.push(`| ${market.market_id} | ${market.price_type} | ${market.observed_on} | ${market.mid} | ${market.unit} |`);
    lines.push(``);
  }
  return lines.join("\n");
}
