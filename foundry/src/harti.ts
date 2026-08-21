import { createHash } from "node:crypto";

import { discoverHartiArchive } from "@lanka-pricelens/shared/harti-archive";

import type { TextItem } from "./pdf.ts";

export type Publication = {
  key: string;
  title: string;
  date: string;
  landingUrl: string;
  downloadUrl: string;
};

export type ParsedObservation = {
  rowRef: string;
  itemLabel: string;
  marketLabel: string;
  date: string;
  sourceQuantity: string;
  sourceUnit: string;
  minValueMinor: number;
  maxValueMinor: number;
  raw: unknown;
};

const currentMarkets = [
  "Peliyagoda",
  "Kandy",
  "Dambulla",
  "Meegoda",
  "Norochchole",
  "Thambuththegama",
  "Keppetipola",
  "Nuwaraeliya",
  "Bandarawela",
  "Veyangoda",
] as const;

const legacyMarkets = ["Pettah", "Kandy", "Dambulla", "Meegoda", "Norochchole", "Thambuththegama", "Keppetipola", "Nuwaraeliya"] as const;

const minMaxMarkets = [
  "Peliyagoda",
  "Norochchole",
  "Kandy",
  "Nuwaraeliya",
  "Dambulla",
  "Thambuththegama",
  "Keppetipola",
  "Meegoda",
  "Bandarawela",
  "Veyangoda",
] as const;

export function discoverHartiDaily(
  html: string,
  landingUrl: string,
  range: { from?: string | undefined; to?: string | undefined } = {},
): Publication[] {
  return discoverHartiArchive(html, landingUrl, range).map((publication) => ({
    ...publication,
    key: createHash("sha256").update(publication.downloadUrl).digest("hex").slice(0, 24),
    landingUrl,
  }));
}

export function parseHartiWholesale(items: TextItem[]): ParsedObservation[] {
  const varietyHeader = items.find((item) => item.text === "Variety");
  if (varietyHeader) return parseVarietyTable(items, varietyHeader);
  const itemHeader = items.find(
    (item) => item.text === "Item" && items.some((candidate) => candidate.page === item.page && candidate.text === "Serial" && Math.abs(candidate.y - item.y) < 2),
  );
  if (itemHeader) return parseMinMaxTable(items, itemHeader);
  throw new Error("SOURCE_TEMPLATE_CHANGED: missing supported table header");
}

function parseVarietyTable(items: TextItem[], varietyHeader: TextItem): ParsedObservation[] {
  const page = items.filter((item) => item.page === varietyHeader.page);
  const headerY = varietyHeader.y;
  const dates = page
    .flatMap((item) => {
      const date = hartiDate(item.text);
      return date && item.y > headerY && item.y < headerY + 40 ? [{ item, date }] : [];
    })
    .sort((left, right) => left.item.x - right.item.x);
  const names = dates.length === currentMarkets.length ? currentMarkets : dates.length === legacyMarkets.length ? legacyMarkets : undefined;
  if (!names) throw new Error(`SOURCE_TEMPLATE_CHANGED: unsupported market count ${dates.length}`);
  return parseRows(
    page.filter((item) => item.y < headerY - 2),
    varietyHeader.page,
    dates.map(({ item, date }, index) => ({ name: names[index]!, x: item.x + item.width / 2, date })),
  );
}

function parseMinMaxTable(items: TextItem[], itemHeader: TextItem): ParsedObservation[] {
  const page = items.filter((item) => item.page === itemHeader.page);
  const rangeHeaders = page
    .filter((item) => ["Min", "Max"].includes(item.text) && item.y < itemHeader.y && item.y > itemHeader.y - 30)
    .sort((left, right) => left.x - right.x);
  if (rangeHeaders.length !== minMaxMarkets.length * 2) {
    throw new Error(`SOURCE_TEMPLATE_CHANGED: unsupported min/max column count ${rangeHeaders.length}`);
  }
  const date = page.flatMap((item) => datesInText(item.text)).find(Boolean);
  if (!date) throw new Error("SOURCE_TEMPLATE_CHANGED: missing table date");
  const previousDate = page.find((item) => /previous day/iu.test(item.text))?.text;
  const prior = previousDate ? datesInText(previousDate).at(-1) : undefined;
  const markets = minMaxMarkets.map((name, index) => {
    const minimum = rangeHeaders[index * 2]!;
    const maximum = rangeHeaders[index * 2 + 1]!;
    return {
      name,
      x: (minimum.x + minimum.width / 2 + maximum.x + maximum.width / 2) / 2,
      date: prior && ["Meegoda", "Veyangoda"].includes(name) ? prior : date,
    };
  });
  return parseRows(page.filter((item) => item.y < itemHeader.y - 2), itemHeader.page, markets);
}

function parseRows(items: TextItem[], pageNumber: number, markets: Array<{ name: string; x: number; date: string }>): ParsedObservation[] {
  const firstMarketLeft = markets[0]!.x - (markets[1]!.x - markets[0]!.x) / 2;
  const boundaries = markets.map((market, index) => ({
    ...market,
    left: index === 0 ? firstMarketLeft : (markets[index - 1]!.x + market.x) / 2,
    right: index === markets.length - 1 ? Number.POSITIVE_INFINITY : (market.x + markets[index + 1]!.x) / 2,
  }));
  const rows = groupRows(items);
  const observations: ParsedObservation[] = [];
  let continuationParent: string | undefined;

  for (const row of rows) {
    const labels = row.filter((item) => item.x < firstMarketLeft && !/^\d+$/u.test(item.text)).map((item) => item.text);
    const sourceLabel = labels.join(" ").replace(/\s+/gu, " ").trim();
    if (!sourceLabel) continue;
    const itemLabel = sourceLabel.startsWith("- ") && continuationParent ? `${continuationParent} ${sourceLabel}` : sourceLabel;
    if (!sourceLabel.startsWith("- ")) continuationParent = sourceLabel.match(/^(.+?)\s+-\s+\S/u)?.[1]?.trim();
    const sourceUnit = /\(Rs\/Fruits?\)/iu.test(itemLabel) ? "fruit" : "kg";
    const numbers = numberTokens(row.filter((item) => item.x >= firstMarketLeft));
    for (const market of boundaries) {
      const values = numbers.filter((number) => number.x >= market.left && number.x < market.right).map((number) => number.value);
      if (values.length !== 2 || values.some((value) => !Number.isFinite(value) || value < 0)) continue;
      const [minimum, maximum] = values;
      if (minimum === undefined || maximum === undefined || minimum > maximum) continue;
      observations.push({
        rowRef: `p${pageNumber}:y${row[0]!.y.toFixed(2)}`,
        itemLabel,
        marketLabel: market.name,
        date: market.date,
        sourceQuantity: "1",
        sourceUnit,
        minValueMinor: Math.round(minimum * 100),
        maxValueMinor: Math.round(maximum * 100),
        raw: row,
      });
    }
  }

  if (observations.length < 10) throw new Error("SOURCE_TEMPLATE_CHANGED: too few wholesale observations");
  return observations;
}

function hartiDate(value: string): string | undefined {
  const parts = value.match(/^(?:(\d{4})\.(\d{2})\.(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))$/u);
  if (!parts) return undefined;
  const [year, month, day] = parts[1] ? [parts[1], parts[2], parts[3]] : [parts[6], parts[5], parts[4]];
  const date = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

function datesInText(value: string): string[] {
  return [...value.matchAll(/\d{4}\.\d{2}\.\d{2}|\d{1,2}\/\d{1,2}\/\d{4}/gu)].flatMap((match) => {
    const date = hartiDate(match[0]);
    return date ? [date] : [];
  });
}

function numberTokens(items: TextItem[]): Array<{ x: number; value: number }> {
  return items.flatMap((item) =>
    [...item.text.matchAll(/\d+(?:\.\d+)?/gu)].map((match) => ({
      x: item.x + item.width * ((match.index + match[0].length / 2) / item.text.length),
      value: Number(match[0]),
    })),
  );
}

function groupRows(items: TextItem[]): TextItem[][] {
  const groups: TextItem[][] = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const row = groups.at(-1);
    if (row && Math.abs(row[0]!.y - item.y) < 2) row.push(item);
    else groups.push([item]);
  }
  return groups.map((row) => row.sort((left, right) => left.x - right.x));
}
