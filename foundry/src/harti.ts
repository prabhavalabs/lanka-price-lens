import { createHash } from "node:crypto";

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
  const links = new Map<string, Publication>();
  const landing = new URL(landingUrl);
  const expression = /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/giu;
  for (const match of html.matchAll(expression)) {
    const href = match[1];
    if (!href || !/assets\/pdf\/food_price\/daily\/eng\//iu.test(href)) continue;
    const date = dateFromPath(href);
    if (!date || (range.from && date < range.from) || (range.to && date > range.to)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, landing);
    } catch {
      continue;
    }
    if (resolved.protocol !== "https:" || resolved.origin !== landing.origin) continue;
    const downloadUrl = resolved.href;
    links.set(downloadUrl, {
      key: createHash("sha256").update(downloadUrl).digest("hex").slice(0, 24),
      title: decodeTitle(downloadUrl),
      date,
      landingUrl,
      downloadUrl,
    });
  }
  return [...links.values()].sort((left, right) => right.date.localeCompare(left.date));
}

function decodeTitle(url: string): string {
  const title = url.split("/").at(-1) ?? "HARTI daily bulletin";
  try {
    return decodeURIComponent(title);
  } catch {
    return title;
  }
}

export function parseHartiWholesale(items: TextItem[]): ParsedObservation[] {
  const page = items.filter((item) => item.page === 1);
  const headerY = page.find((item) => item.text === "Variety")?.y;
  if (headerY === undefined) throw new Error("SOURCE_TEMPLATE_CHANGED: missing Variety header");

  const markets = expectedMarkets.map((name) => {
    const header = page.find((item) => item.text === name && Math.abs(item.y - headerY) < 2);
    if (!header) throw new Error(`SOURCE_TEMPLATE_CHANGED: missing ${name} header`);
    const dateItem = page
      .filter((item) => /^\d{4}\.\d{2}\.\d{2}$/u.test(item.text) && item.y > headerY)
      .sort((left, right) => Math.abs(left.x - header.x) - Math.abs(right.x - header.x))[0];
    if (!dateItem) throw new Error(`SOURCE_TEMPLATE_CHANGED: missing ${name} date`);
    return { name, x: header.x, date: dateItem.text.replaceAll(".", "-") };
  });

  const boundaries = markets.map((market, index) => ({
    ...market,
    left: index === 0 ? 108 : (markets[index - 1]!.x + market.x) / 2,
    right: index === markets.length - 1 ? Number.POSITIVE_INFINITY : (market.x + markets[index + 1]!.x) / 2,
  }));
  const rows = groupRows(page.filter((item) => item.y < headerY - 2));
  const observations: ParsedObservation[] = [];

  for (const row of rows) {
    const labels = row.filter((item) => item.x < 108).map((item) => item.text);
    const itemLabel = labels.join(" ").replace(/\s+/gu, " ").trim();
    if (!itemLabel) continue;
    for (const market of boundaries) {
      const values = row
        .filter((item) => item.x >= market.left && item.x < market.right && /^\d+(?:\.\d+)?$/u.test(item.text))
        .map((item) => Number(item.text));
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

function dateFromPath(path: string): string | undefined {
  const yearFirst = path.match(/(20\d{2})[._-](\d{2})[._-](\d{2})/u);
  if (yearFirst) return `${yearFirst[1]}-${yearFirst[2]}-${yearFirst[3]}`;
  const dayFirst = path.match(/(?<!\d)(\d{2})[._-](\d{2})[._-](20\d{2})(?!\d)/u);
  return dayFirst ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}` : undefined;
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
