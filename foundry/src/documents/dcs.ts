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
  type DocumentAdapter,
  type DocumentParseResult,
  type ParsedObservation,
  type Publication,
} from "./types.ts";

const reportPath = "/Resource/en/InflationAndPrices/retail";
export const dcsMarketLabel = "Colombo District (retail)";

/**
 * Department of Census and Statistics "Open Market Weekly Average Retail
 * Prices, Main Markets in Colombo District". One PDF per week at a predictable
 * URL (DCSB-WRP-<yyyy>-<mm>-W<n>.pdf); the statistics site lists only older
 * years, so discovery probes the recent weeks directly.
 */
export const dcsWeeklyRetailAdapter: DocumentAdapter = {
  kind: "dcs_weekly_retail",
  label: "DCS Weekly Retail Prices",
  description: "Probes the statistics site for each recent week's report and reads its average, range, and change columns.",
  parserVersion: "dcs-weekly@1",
  async discover(context) {
    const origin = new URL(context.manifest.landing_url).origin;
    const today = context.now.toISOString().slice(0, 10);
    const to = context.range.to && context.range.to < today ? context.range.to : today;
    const from = context.range.from ?? shiftDays(today, -70);
    const candidates = weekCandidates(from, to);
    if (candidates.length > 80) context.log("warning", "Range covers many weeks; probing the most recent 80", { candidates: candidates.length });
    const publications: Publication[] = [];
    for (const candidate of candidates.slice(0, 80)) {
      const url = `${origin}${reportPath}/${candidate.file}`;
      const status = await probe(context.request, url);
      if (status === null) {
        context.log("warning", "Could not reach the statistics site for a week; it will be retried next run", { file: candidate.file });
        continue;
      }
      if (status !== 200) continue;
      publications.push({ key: publicationKey(url), title: candidate.file, date: candidate.date, landingUrl: context.manifest.landing_url, downloadUrl: url });
    }
    context.log("info", "Weekly reports probed", { candidates: Math.min(candidates.length, 80), found: publications.length });
    return publications.sort((left, right) => right.date.localeCompare(left.date));
  },
  archiveKey(publication) {
    return archiveObjectKey("sources/dcs/weekly-retail-prices", publication);
  },
  parse(items, publication) {
    const lines = linesOf(items);
    const titleLine = lines.find((line) => /weekly average retail prices/iu.test(lineText(line)));
    if (!titleLine) throw new DocumentParseError("UNSUPPORTED_DOCUMENT", "No weekly retail price title found");
    const period = periodFromTitle(lineText(titleLine));
    const date = period?.date ?? publication.date;

    const observations: ParsedObservation[] = [];
    const warnings: string[] = [];
    let itemRows = 0;
    let parsedRows = 0;
    const pages = [...new Set(lines.map((line) => line.page))];
    for (const page of pages) {
      const pageLines = lines.filter((line) => line.page === page);
      const header = pageLines.find((line) => line.cells.some((cell) => /^item$/iu.test(cell.text.trim())) && line.cells.some((cell) => /^unit$/iu.test(cell.text.trim())));
      if (!header) continue;
      const unitHeader = header.cells.find((cell) => /^unit$/iu.test(cell.text.trim()))!;
      const body = pageLines.slice(pageLines.indexOf(header) + 1).filter((line) => !/^(avg|%|price range|of|this week|\d{4}$|[A-Za-z]{3}\.? ?\d{0,4}$|\d(st|nd|rd|th) week)/iu.test(lineText(line)));
      const rows = body
        .map((line) => {
          const label = line.cells[0];
          if (!label || label.x > 150 || /^\*|^source|^note/iu.test(label.text)) return null;
          const unitCell = line.cells.slice(1).find((cell) => Math.abs(centerOf(cell) - centerOf(unitHeader)) < 70 && parsePrintedUnit(cell.text));
          if (!unitCell) return null;
          const numbers = line.cells
            .filter((cell) => cell !== label && cell !== unitCell && !cell.text.includes("%"))
            .map((cell) => ({ x: centerOf(cell), value: parsePrintedNumber(cell.text) }))
            .filter((cell): cell is { x: number; value: number } => cell.value !== null);
          return { line, label: label.text.trim(), unitCell, numbers };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);
      // Column centres are learnt from complete rows (last year, previous week, this week, range low, range high).
      const complete = rows.filter((row) => row.numbers.length === 5);
      const centers = [0, 1, 2, 3, 4].map((index) => median(complete.map((row) => row.numbers[index]!.x)));
      let group: string | null = null;
      for (const row of rows) {
        itemRows += 1;
        const label = qualifiedLabel(row.label, group);
        group = groupOf(row.label) ?? (isQualifier(row.label) ? group : null);
        const unit = parsePrintedUnit(row.unitCell.text);
        if (!unit) continue;
        const byColumn: Array<number | undefined> = [];
        for (const number of row.numbers) {
          const column = complete.length >= 3 ? nearestColumn(number.x, centers, 25) : row.numbers.length === 5 ? row.numbers.indexOf(number) : -1;
          if (column !== -1) byColumn[column] = number.value;
        }
        const thisWeek = byColumn[2];
        if (thisWeek === undefined || thisWeek <= 0) {
          if (row.numbers.length) warnings.push(`No weekly average for ${label}`);
          continue;
        }
        const low = byColumn[3];
        const high = byColumn[4];
        const useRange = low !== undefined && high !== undefined && low > 0 && low <= high;
        observations.push({
          rowRef: slug(label),
          itemLabel: label,
          marketLabel: dcsMarketLabel,
          date,
          sourceQuantity: unit.quantity,
          sourceUnit: unit.unit,
          minValueMinor: Math.round((useRange ? low : thisWeek) * 100),
          maxValueMinor: Math.round((useRange ? high : thisWeek) * 100),
          priceType: "retail_observed",
          raw: {
            printed_label: row.label,
            printed_unit: row.unitCell.text.trim(),
            average_this_week: thisWeek,
            average_previous_week: byColumn[1] ?? null,
            average_last_year: byColumn[0] ?? null,
            range_low: useRange ? low : null,
            range_high: useRange ? high : null,
            week: period?.week ?? null,
            month: period?.month ?? null,
            year: period?.year ?? null,
            page,
          },
        });
        parsedRows += 1;
      }
    }
    if (!observations.length) throw new DocumentParseError("SOURCE_TEMPLATE_CHANGED", "Weekly table produced no observations", { title: lineText(titleLine) });
    return {
      observations,
      strategy: "dcs_weekly_average_table",
      confidence: itemRows ? parsedRows / itemRows : 0,
      warnings,
      page: titleLine.page,
      signals: { title: lineText(titleLine), date, item_rows: itemRows, parsed_rows: parsedRows, pages: pages.length },
    } satisfies DocumentParseResult;
  },
};

/** Week n of a month is filed under its first day (1st, 8th, 15th, 22nd, 29th). */
export function periodFromTitle(title: string): { week: number; month: number; year: number; date: string } | null {
  const match = title.match(/(\d)(?:st|nd|rd|th)\s+week\s+of\s+([A-Za-z]+)\.?\s+(\d{4})/iu);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const month = monthNumber(match[2]);
  if (!month) return null;
  const week = Number(match[1]);
  return { week, month, year: Number(match[3]), date: isoDate(Number(match[3]), month, 1 + (week - 1) * 7) };
}

export function weekCandidates(from: string, to: string): Array<{ file: string; date: string }> {
  const candidates: Array<{ file: string; date: string }> = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const endYear = Number(to.slice(0, 4));
  const endMonth = Number(to.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    for (let week = 1; week <= 5; week += 1) {
      const date = isoDate(year, month, 1 + (week - 1) * 7);
      if (date >= from && date <= to) candidates.push({ file: `DCSB-WRP-${year}-${String(month).padStart(2, "0")}-W${week}.pdf`, date });
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return candidates.sort((left, right) => right.date.localeCompare(left.date));
}

/** HEAD first; some servers refuse it, so fall back to a GET whose body is discarded. Null means the network failed. */
async function probe(request: typeof fetch, url: string): Promise<number | null> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const response = await request(url, { method, signal: AbortSignal.timeout(20_000) });
      if (method === "GET" || (response.status !== 405 && response.status !== 403 && response.status !== 501)) {
        const type = response.headers.get("content-type") ?? "";
        if (response.body && method === "GET") await response.body.cancel();
        return response.status === 200 && !type.includes("text/html") ? 200 : response.status === 200 ? 404 : response.status;
      }
    } catch {
      if (method === "GET") return null;
    }
  }
  return null;
}

function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** "Potatoes - Local" followed by a bare "Imported" row means "Potatoes - Imported". */
function groupOf(label: string): string | null {
  const match = label.match(/^(.+?)\s*-\s*[A-Za-z .()]+$/u);
  return match?.[1]?.trim() ?? null;
}

function isQualifier(label: string): boolean {
  return /^\(?\s*(imported|local|large|medium|small|average|white|red|broiler|fresh|no\.?\s*\d+\.?(?:\s*\([A-Za-z ]+\))?)\s*\)?\.?$/iu.test(label.trim());
}

function qualifiedLabel(label: string, group: string | null): string {
  const cleaned = label.replace(/\s+/gu, " ").trim();
  return group && isQualifier(cleaned) ? `${group} - ${cleaned}` : cleaned;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)]! : Number.NaN;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
}

export function dcsInRange(date: string, range: { from?: string | undefined; to?: string | undefined }): boolean {
  return inRange(date, range);
}
