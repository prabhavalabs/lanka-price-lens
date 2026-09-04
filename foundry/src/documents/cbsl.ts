import { parsePrintedNumber, parsePrintedUnit } from "../units.ts";
import {
  archiveObjectKey,
  centerOf,
  DocumentParseError,
  inRange,
  isoDate,
  linesOf,
  lineText,
  monthNumber,
  nearestColumn,
  publicationKey,
  type DiscoveryContext,
  type DocumentAdapter,
  type DocumentParseResult,
  type Line,
  type ParsedObservation,
  type Publication,
} from "./types.ts";

/**
 * Central Bank of Sri Lanka "Daily Price Report": page one is narrative, the
 * "Wholesale and Retail Prices: Selected Food Commodities" page is a table with
 * one row per item and Yesterday/Today pairs per market under two groups,
 * Wholesale Prices and Retail Prices. Sections (VEGETABLES, OTHER, FISH) may
 * re-declare the market columns.
 */
export const cbslDailyPriceAdapter: DocumentAdapter = {
  kind: "cbsl_daily_price",
  label: "CBSL Daily Price Report",
  description: "Lists the day's reports on the Central Bank's price-report page and reads the wholesale and retail table.",
  parserVersion: "cbsl-daily@1",
  async discover(context) {
    const publications = new Map<string, Publication>();
    const landing = new URL(context.manifest.landing_url);
    const collect = (html: string): { added: number; oldest: string | null } => {
      let added = 0;
      const dates: string[] = [];
      for (const match of html.matchAll(/href=["']([^"']*price_report_(\d{4})(\d{2})(\d{2})_e\.pdf)["'][^>]*>([^<]*)/giu)) {
        const [, href, year, month, day, text] = match;
        if (!href || !year || !month || !day) continue;
        let resolved: URL;
        try {
          resolved = new URL(href, landing);
        } catch {
          continue;
        }
        const date = `${year}-${month}-${day}`;
        dates.push(date);
        if (!inRange(date, context.range) || publications.has(resolved.href)) continue;
        publications.set(resolved.href, {
          key: publicationKey(resolved.href),
          title: text?.trim() || `Daily Price Report - ${date}`,
          date,
          landingUrl: context.manifest.landing_url,
          downloadUrl: resolved.href,
        });
        added += 1;
      }
      return { added, oldest: dates.length ? dates.sort()[0]! : null };
    };
    let page = collect(context.html);
    // Older reports sit on numbered pages; walk back only as far as the requested range needs.
    for (let index = 1; context.range.from && page.oldest && page.oldest >= context.range.from && index <= 60; index += 1) {
      const url = new URL(landing.href);
      url.searchParams.set("page", String(index));
      const response = await context.fetchWithRetry(url.href);
      const html = new TextDecoder().decode(await context.readBody(response, 5 * 1024 * 1024));
      page = collect(html);
      context.log("info", "Older report page scanned", { page: index, added: page.added, oldest: page.oldest });
      if (!page.oldest) break;
    }
    return [...publications.values()].sort((left, right) => right.date.localeCompare(left.date));
  },
  archiveKey(publication) {
    return archiveObjectKey("sources/cbsl/daily-price-report", publication);
  },
  parse(items, publication) {
    const lines = linesOf(items);
    const titleIndex = lines.findIndex((line) => /wholesale and retail prices/iu.test(lineText(line)));
    if (titleIndex === -1) throw new DocumentParseError("UNSUPPORTED_DOCUMENT", "No wholesale and retail price table found", { pages: new Set(items.map((item) => item.page)).size });
    const title = lineText(lines[titleIndex]!);
    const page = lines[titleIndex]!.page;
    const date = dateFromTitle(title) ?? publication.date;
    const tableLines = lines.filter((line) => line.page === page).slice(lines.filter((line) => line.page === page).indexOf(lines[titleIndex]!) + 1);

    const groupLine = tableLines.find((line) => /wholesale prices/iu.test(lineText(line)) && /retail prices/iu.test(lineText(line)));
    const todayLine = tableLines.find((line) => line.cells.filter((cell) => /^today$/iu.test(cell.text.trim())).length >= 2);
    if (!groupLine || !todayLine) throw new DocumentParseError("SOURCE_TEMPLATE_CHANGED", "Price table headers not recognised", { title });
    const wholesaleCell = groupLine.cells.find((cell) => /wholesale/iu.test(cell.text));
    const retailCell = groupLine.cells.find((cell) => /retail/iu.test(cell.text));
    const split = wholesaleCell && retailCell ? (centerOf(wholesaleCell) + centerOf(retailCell)) / 2 : Number.POSITIVE_INFINITY;
    const todayCenters = todayLine.cells.filter((cell) => /^today$/iu.test(cell.text.trim())).map(centerOf);

    const observations: ParsedObservation[] = [];
    const warnings: string[] = [];
    let markets = marketColumns(tableLines.slice(tableLines.indexOf(groupLine) + 1, tableLines.indexOf(todayLine)), todayCenters, split);
    let section = "general";
    let itemRows = 0;
    let parsedRows = 0;
    const unheaded = new Set<number>();

    for (const line of tableLines.slice(tableLines.indexOf(todayLine) + 1)) {
      const text = lineText(line);
      if (/^n\.a\.|^¢|price (increased|decreased)/iu.test(text)) continue;
      if (line.cells.length === 1 && /^[A-Z](?:\s*[A-Z])+$/u.test(text)) {
        section = text.replace(/\s+/gu, "").toLowerCase();
        continue;
      }
      const unitCell = line.cells.find((cell) => /^rs\.?\s*\//iu.test(cell.text.trim()));
      const label = line.cells[0]?.text.trim() ?? "";
      if (!unitCell) {
        if (line.cells.length >= 2 && line.cells.every((cell) => /^[A-Za-z][A-Za-z .()'-]*$/u.test(cell.text.trim()))) {
          markets = marketColumns([line], todayCenters, split);
        }
        continue;
      }
      if (!label || line.cells[0] === unitCell || (line.cells[0]?.x ?? 0) > 80) continue;
      itemRows += 1;
      const unit = parsePrintedUnit(unitCell.text);
      if (!unit) {
        warnings.push(`Unit not understood for ${label}: ${unitCell.text.trim()}`);
        continue;
      }
      let rowParsed = false;
      for (const cell of line.cells.slice(line.cells.indexOf(unitCell) + 1)) {
        const value = parsePrintedNumber(cell.text);
        if (value === null || value <= 0) continue;
        const column = nearestColumn(centerOf(cell), todayCenters, 16);
        if (column === -1) continue; // a "Yesterday" value, already reported in the previous day's document
        const market = markets[column];
        if (!market) {
          unheaded.add(column);
          continue;
        }
        const minor = Math.round(value * 100);
        observations.push({
          rowRef: `${section}/${slug(label)}`,
          itemLabel: label.replace(/\s+/gu, " "),
          marketLabel: market.label,
          date,
          sourceQuantity: unit.quantity,
          sourceUnit: unit.unit,
          minValueMinor: minor,
          maxValueMinor: minor,
          priceType: market.priceType,
          raw: { section, market: market.market, price_type: market.priceType, printed_unit: unitCell.text.trim(), report_date: date },
        });
        rowParsed = true;
      }
      if (rowParsed) parsedRows += 1;
    }
    if (unheaded.size) warnings.push(`${unheaded.size} value column(s) had no market heading and were skipped`);
    if (!observations.length) throw new DocumentParseError("SOURCE_TEMPLATE_CHANGED", "Price table produced no observations", { title, item_rows: itemRows });
    return {
      observations,
      strategy: "cbsl_wholesale_retail_table",
      confidence: itemRows ? parsedRows / itemRows : 0,
      warnings,
      page,
      signals: { title, date, item_rows: itemRows, parsed_rows: parsedRows, markets: markets.filter(Boolean).map((market) => market!.label) },
    } satisfies DocumentParseResult;
  },
};

type MarketColumn = { market: string; label: string; priceType: "wholesale_observed" | "retail_observed" };

/** Maps each "Today" column to the nearest market heading; columns without a heading stay undefined. */
function marketColumns(headerLines: Line[], todayCenters: number[], split: number): Array<MarketColumn | undefined> {
  const headings = headerLines
    .flatMap((line) => line.cells)
    .filter((cell) => /^[A-Za-z][A-Za-z .()'-]*$/u.test(cell.text.trim()) && !/^(yesterday|today|item|unit)$/iu.test(cell.text.trim()))
    .map((cell) => ({ x: centerOf(cell), name: cell.text.trim() }));
  return todayCenters.map((center) => {
    const heading = headings.reduce<{ x: number; name: string } | null>((best, candidate) => (Math.abs(candidate.x - center) < Math.abs((best?.x ?? Number.POSITIVE_INFINITY) - center) ? candidate : best), null);
    if (!heading || Math.abs(heading.x - center) > 60) return undefined;
    const priceType = center < split ? "wholesale_observed" : "retail_observed";
    return { market: heading.name, label: `${heading.name} (${priceType === "wholesale_observed" ? "wholesale" : "retail"})`, priceType };
  });
}

function dateFromTitle(title: string): string | null {
  const match = title.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/u);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const month = monthNumber(match[2]);
  return month ? isoDate(Number(match[3]), month, Number(match[1])) : null;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

export function cbslDiscoveryForTests(context: DiscoveryContext): Promise<Publication[]> {
  return cbslDailyPriceAdapter.discover(context);
}
