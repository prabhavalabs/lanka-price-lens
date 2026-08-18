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
  minValueMinor: number;
  maxValueMinor: number;
  raw: unknown;
};

const expectedMarkets = [
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
  const page = items.filter((item) => item.page === 1);
  const varietyHeader = page.find((item) => item.text === "Variety");
  if (!varietyHeader) throw new Error("SOURCE_TEMPLATE_CHANGED: missing Variety header");
  const headerY = varietyHeader.y;

  const markets = expectedMarkets.map((name) => {
    const header = page.find((item) => item.text === name && Math.abs(item.y - headerY) < 2);
    if (!header) throw new Error(`SOURCE_TEMPLATE_CHANGED: missing ${name} header`);
    const dateItem = page
      .filter((item) => /^\d{4}\.\d{2}\.\d{2}$/u.test(item.text) && item.y > headerY)
      .sort((left, right) => Math.abs(left.x - header.x) - Math.abs(right.x - header.x))[0];
    if (!dateItem) throw new Error(`SOURCE_TEMPLATE_CHANGED: missing ${name} date`);
    return { name, x: header.x + header.width / 2, date: dateItem.text.replaceAll(".", "-") };
  });

  const firstMarketLeft = markets[0]!.x - (markets[1]!.x - markets[0]!.x) / 2;
  const boundaries = markets.map((market, index) => ({
    ...market,
    left: index === 0 ? firstMarketLeft : (markets[index - 1]!.x + market.x) / 2,
    right: index === markets.length - 1 ? Number.POSITIVE_INFINITY : (market.x + markets[index + 1]!.x) / 2,
  }));
  const rows = groupRows(page.filter((item) => item.y < headerY - 2));
  const observations: ParsedObservation[] = [];

  for (const row of rows) {
    const labels = row.filter((item) => item.x < firstMarketLeft).map((item) => item.text);
    const itemLabel = labels.join(" ").replace(/\s+/gu, " ").trim();
    if (!itemLabel) continue;
    for (const market of boundaries) {
      const values = row
        .filter((item) => item.x >= market.left && item.x < market.right)
        .flatMap((item) => item.text.match(/\d+(?:\.\d+)?/gu) ?? [])
        .map(Number);
      if (values.length !== 2 || values.some((value) => !Number.isFinite(value) || value < 0)) continue;
      const [minimum, maximum] = values;
      if (minimum === undefined || maximum === undefined || minimum > maximum) continue;
      observations.push({
        rowRef: `p1:y${row[0]!.y.toFixed(2)}`,
        itemLabel,
        marketLabel: market.name,
        date: market.date,
        minValueMinor: Math.round(minimum * 100),
        maxValueMinor: Math.round(maximum * 100),
        raw: row,
      });
    }
  }

  if (observations.length < 10) throw new Error("SOURCE_TEMPLATE_CHANGED: too few wholesale observations");
  return observations;
}

function groupRows(items: TextItem[]): TextItem[][] {
  const groups = new Map<number, TextItem[]>();
  for (const item of items) {
    const key = Math.round(item.y * 2);
    const row = groups.get(key) ?? [];
    row.push(item);
    groups.set(key, row);
  }
  return [...groups.values()].map((row) => row.sort((left, right) => left.x - right.x));
}
