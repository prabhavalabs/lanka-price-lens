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
  /** Overrides the artifact-level price type when a document mixes several. */
  priceType?: string | undefined;
  raw: unknown;
};

export type HartiParserStrategy = "labelled_market_date_grid" | "inferred_market_date_grid" | "min_max_market_grid";

export type HartiCandidateRejection = {
  page: number;
  strategy: HartiParserStrategy;
  reason: string;
};

export type HartiParseDiagnostics = {
  strategy: HartiParserStrategy;
  confidence: number;
  page: number;
  headerLabel: string | null;
  marketCount: number;
  observationCount: number;
  signals: string[];
  warnings: string[];
  rejectedCandidates: HartiCandidateRejection[];
};

export type HartiParseResult = {
  observations: ParsedObservation[];
  diagnostics: HartiParseDiagnostics;
};

export class HartiParseError extends Error {
  readonly code: "SOURCE_TEMPLATE_CHANGED" | "UNSUPPORTED_DOCUMENT";
  readonly rejectedCandidates: HartiCandidateRejection[];

  constructor(code: HartiParseError["code"], message: string, rejectedCandidates: HartiCandidateRejection[] = []) {
    super(`${code}: ${message}`);
    this.name = "HartiParseError";
    this.code = code;
    this.rejectedCandidates = rejectedCandidates;
  }
}

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

const marketAliases = new Map<string, string>([
  ["peliyagoda", "Peliyagoda"],
  ["pettah", "Pettah"],
  ["kandy", "Kandy"],
  ["dambulla", "Dambulla"],
  ["meegoda", "Meegoda"],
  ["norochchole", "Norochchole"],
  ["norochcholai", "Norochchole"],
  ["thambuththegama", "Thambuththegama"],
  ["thambuttegama", "Thambuththegama"],
  ["keppetipola", "Keppetipola"],
  ["nuwaraeliya", "Nuwaraeliya"],
  ["nuwara eliya", "Nuwaraeliya"],
  ["bandarawela", "Bandarawela"],
  ["veyangoda", "Veyangoda"],
]);

const labelHeaderAliases = new Set(["variety", "item", "commodity", "produce", "product"]);
const serialHeaderAliases = new Set(["serial", "serial no", "s no", "sno", "no"]);
const minimumHeaderAliases = new Set(["min", "minimum"]);
const maximumHeaderAliases = new Set(["max", "maximum"]);

type DateCell = { item: TextItem; date: string };
type DateBand = { page: number; y: number; cells: DateCell[] };
type DatedCandidate = {
  strategy: "labelled_market_date_grid" | "inferred_market_date_grid";
  page: number;
  header: TextItem | null;
  headerY: number;
  band: DateBand;
};
type MinMaxCandidate = {
  strategy: "min_max_market_grid";
  page: number;
  header: TextItem;
};
type ParserCandidate = DatedCandidate | MinMaxCandidate;
type CandidateSuccess = Omit<HartiParseDiagnostics, "rejectedCandidates"> & { observations: ParsedObservation[] };

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
  return parseHartiWholesaleWithDiagnostics(items).observations;
}

export function parseHartiWholesaleWithDiagnostics(items: TextItem[]): HartiParseResult {
  if (!items.length) throw new HartiParseError("UNSUPPORTED_DOCUMENT", "document contains no extractable text");
  const candidates = parserCandidates(items);
  const rejected: HartiCandidateRejection[] = [];
  const successes: CandidateSuccess[] = [];

  for (const candidate of candidates) {
    try {
      successes.push(candidate.strategy === "min_max_market_grid" ? parseMinMaxCandidate(items, candidate) : parseDatedCandidate(items, candidate));
    } catch (error) {
      rejected.push({
        page: candidate.page,
        strategy: candidate.strategy,
        reason: compactReason(error),
      });
    }
  }

  const best = successes.sort((left, right) => right.confidence - left.confidence || right.observationCount - left.observationCount)[0];
  if (best) {
    return {
      observations: best.observations,
      diagnostics: {
        strategy: best.strategy,
        confidence: best.confidence,
        page: best.page,
        headerLabel: best.headerLabel,
        marketCount: best.marketCount,
        observationCount: best.observationCount,
        signals: best.signals,
        warnings: best.warnings,
        rejectedCandidates: rejected.slice(0, 12),
      },
    };
  }

  const identitySignals = sourceIdentitySignals(items);
  const reason = rejected[0]?.reason ?? "no compatible market/date or min/max grid was found";
  const code = identitySignals.length ? "SOURCE_TEMPLATE_CHANGED" : "UNSUPPORTED_DOCUMENT";
  throw new HartiParseError(code, `${reason}; ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} evaluated`, rejected.slice(0, 12));
}

function parserCandidates(items: TextItem[]): ParserCandidate[] {
  const candidates: ParserCandidate[] = [];
  const pages = [...new Set(items.map((item) => item.page))].sort((left, right) => left - right);
  for (const pageNumber of pages) {
    const page = items.filter((item) => item.page === pageNumber);
    const bands = dateBands(page).filter(
      (band) => band.cells.length === legacyMarkets.length || band.cells.length === currentMarkets.length,
    );
    const headers = page.filter((item) => labelHeaderAliases.has(normalizeText(item.text)));
    for (const header of headers) {
      const nearbyBands = bands.filter((band) => band.y >= header.y - 4 && band.y <= header.y + 45);
      for (const band of nearbyBands) {
        candidates.push({ strategy: "labelled_market_date_grid", page: pageNumber, header, headerY: header.y, band });
      }
    }
    for (const band of bands) {
      if (!headers.some((header) => Math.abs(header.y - inferredHeaderY(page, band)) < 4)) {
        candidates.push({ strategy: "inferred_market_date_grid", page: pageNumber, header: null, headerY: inferredHeaderY(page, band), band });
      }
    }
    for (const header of headers) {
      const hasSerial = page.some(
        (item) => serialHeaderAliases.has(normalizeText(item.text)) && Math.abs(item.y - header.y) < 5,
      );
      if (hasSerial) candidates.push({ strategy: "min_max_market_grid", page: pageNumber, header });
    }
  }
  return candidates;
}

function parseDatedCandidate(items: TextItem[], candidate: DatedCandidate): CandidateSuccess {
  const page = items.filter((item) => item.page === candidate.page);
  const signals = sourceIdentitySignals(page);
  if (!signals.length) throw new Error("missing HARTI wholesale-price identity signals");
  const warnings: string[] = [];
  const resolvedNames = marketNamesForDateBand(page, candidate.band, candidate.headerY);
  const positionalNames = candidate.band.cells.length === currentMarkets.length
    ? [...currentMarkets]
    : candidate.band.cells.length === legacyMarkets.length
      ? [...legacyMarkets]
      : undefined;
  if (!positionalNames) throw new Error(`unsupported market count ${candidate.band.cells.length}`);
  const names = resolvedNames ?? positionalNames;
  if (!resolvedNames) warnings.push("market_headers_inferred_from_known_column_order");
  if (!candidate.header) warnings.push("label_header_inferred_from_table_geometry");
  const markets = candidate.band.cells.map(({ item, date }, index) => ({
    name: names[index]!,
    x: item.x + item.width / 2,
    date,
  }));
  const observations = parseRows(page.filter((item) => item.y < candidate.headerY - 2), candidate.page, markets);
  validateCandidateObservations(observations, markets.length);
  const distinctLabels = new Set(observations.map((observation) => observation.itemLabel)).size;
  const confidence = boundedConfidence(
    0.45
      + (observations.length >= markets.length * 2 ? 0.15 : 0.08)
      + (distinctLabels >= 3 ? 0.1 : 0.05)
      + (signals.length >= 2 ? 0.1 : 0.05)
      + (candidate.header ? (normalizeText(candidate.header.text) === "variety" ? 0.12 : 0.1) : 0.02)
      + (resolvedNames ? 0.08 : 0.03),
  );
  if (confidence < 0.74) throw new Error(`confidence ${confidence.toFixed(2)} is below the safe parsing threshold`);
  return {
    observations,
    strategy: candidate.strategy,
    confidence,
    page: candidate.page,
    headerLabel: candidate.header?.text ?? null,
    marketCount: markets.length,
    observationCount: observations.length,
    signals,
    warnings,
  };
}

function parseMinMaxCandidate(items: TextItem[], candidate: MinMaxCandidate): CandidateSuccess {
  const page = items.filter((item) => item.page === candidate.page);
  const signals = sourceIdentitySignals(page);
  if (!signals.length) throw new Error("missing HARTI wholesale-price identity signals");
  const rangeHeaders = page
    .filter((item) => {
      const normalized = normalizeText(item.text);
      return (minimumHeaderAliases.has(normalized) || maximumHeaderAliases.has(normalized))
        && item.y < candidate.header.y + 3
        && item.y > candidate.header.y - 40;
    })
    .sort((left, right) => left.x - right.x);
  if (rangeHeaders.length !== minMaxMarkets.length * 2) {
    throw new Error(`unsupported min/max column count ${rangeHeaders.length}`);
  }
  for (let index = 0; index < rangeHeaders.length; index += 2) {
    if (!minimumHeaderAliases.has(normalizeText(rangeHeaders[index]!.text)) || !maximumHeaderAliases.has(normalizeText(rangeHeaders[index + 1]!.text))) {
      throw new Error("min/max column pairs are not ordered consistently");
    }
  }
  const date = page.flatMap((item) => datesInText(item.text)).find(Boolean);
  if (!date) throw new Error("missing table date");
  const previousDate = page.find((item) => /previous day/iu.test(item.text))?.text;
  const prior = previousDate ? datesInText(previousDate).at(-1) : undefined;
  const centers = minMaxMarkets.map((_, index) => {
    const minimum = rangeHeaders[index * 2]!;
    const maximum = rangeHeaders[index * 2 + 1]!;
    return (minimum.x + minimum.width / 2 + maximum.x + maximum.width / 2) / 2;
  });
  const dynamicNames = marketNamesNearCenters(page, centers, Math.min(...rangeHeaders.map((item) => item.y)));
  const names = dynamicNames ?? [...minMaxMarkets];
  const warnings = dynamicNames ? [] : ["market_headers_inferred_from_known_column_order"];
  const markets = names.map((name, index) => ({
    name,
    x: centers[index]!,
    date: prior && ["Meegoda", "Veyangoda"].includes(name) ? prior : date,
  }));
  const rowCeiling = Math.min(...rangeHeaders.map((item) => item.y)) - 2;
  const observations = parseRows(page.filter((item) => item.y < rowCeiling), candidate.page, markets);
  validateCandidateObservations(observations, markets.length);
  const confidence = boundedConfidence(0.82 + (dynamicNames ? 0.08 : 0.03) + (signals.length >= 2 ? 0.08 : 0.04));
  return {
    observations,
    strategy: candidate.strategy,
    confidence,
    page: candidate.page,
    headerLabel: candidate.header.text,
    marketCount: markets.length,
    observationCount: observations.length,
    signals,
    warnings,
  };
}

function dateBands(page: TextItem[]): DateBand[] {
  const dated = page.flatMap((item) => {
    const date = hartiDate(item.text);
    return date ? [{ item, date }] : [];
  });
  const groups: DateCell[][] = [];
  for (const cell of dated.sort((left, right) => right.item.y - left.item.y || left.item.x - right.item.x)) {
    const group = groups.find((candidate) => Math.abs(candidate[0]!.item.y - cell.item.y) < 3);
    if (group) group.push(cell);
    else groups.push([cell]);
  }
  return groups.map((cells) => ({
    page: cells[0]!.item.page,
    y: cells.reduce((total, cell) => total + cell.item.y, 0) / cells.length,
    cells: cells.sort((left, right) => left.item.x - right.item.x),
  }));
}

function inferredHeaderY(page: TextItem[], band: DateBand): number {
  const marketHeaderYs = page.flatMap((item) => {
    const market = canonicalMarket(item.text);
    return market && item.y < band.y + 5 && item.y > band.y - 30 ? [item.y] : [];
  });
  if (!marketHeaderYs.length) return band.y - 12;
  return median(marketHeaderYs);
}

function marketNamesForDateBand(page: TextItem[], band: DateBand, headerY: number): string[] | undefined {
  const centers = band.cells.map(({ item }) => item.x + item.width / 2);
  const candidates = page.flatMap((item) => {
    const name = canonicalMarket(item.text);
    return name && item.y > headerY - 8 && item.y < band.y + 6 ? [{ item, name }] : [];
  });
  return resolveMarketNames(centers, candidates);
}

function marketNamesNearCenters(page: TextItem[], centers: number[], referenceY: number): string[] | undefined {
  const candidates = page.flatMap((item) => {
    const name = canonicalMarket(item.text);
    return name && item.y > referenceY - 5 && item.y < referenceY + 70 ? [{ item, name }] : [];
  });
  return resolveMarketNames(centers, candidates);
}

function resolveMarketNames(
  centers: number[],
  candidates: Array<{ item: TextItem; name: string }>,
): string[] | undefined {
  if (!centers.length || candidates.length < centers.length) return undefined;
  const steps = centers.slice(1).map((center, index) => center - centers[index]!);
  const tolerance = Math.max(28, median(steps) * 0.75);
  const used = new Set<number>();
  const names: string[] = [];
  for (const center of centers) {
    const nearest = candidates
      .map((candidate, index) => ({ ...candidate, index, distance: Math.abs(candidate.item.x + candidate.item.width / 2 - center) }))
      .filter((candidate) => !used.has(candidate.index) && candidate.distance <= tolerance)
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest || names.includes(nearest.name)) return undefined;
    used.add(nearest.index);
    names.push(nearest.name);
  }
  return names;
}

function sourceIdentitySignals(items: TextItem[]): string[] {
  const normalized = items.map((item) => normalizeText(item.text)).join(" ");
  const recognizedMarkets = new Set(items.flatMap((item) => {
    const market = canonicalMarket(item.text);
    return market ? [market] : [];
  }));
  const signals: string[] = [];
  if (/\b(?:hector kobbekaduwa|harti|data management division)\b/u.test(normalized)) signals.push("harti_institution");
  if (/\bwholesale\b/u.test(normalized) && /\bprice/u.test(normalized)) signals.push("wholesale_price_language");
  if (/\b(?:vegetable|fruit|produce)\b/u.test(normalized) && /\b(?:price|market|variety)\b/u.test(normalized)) signals.push("produce_market_language");
  if (/\bprice/u.test(normalized) && /\bmarket\b/u.test(normalized)) signals.push("price_market_language");
  if (recognizedMarkets.size >= 3) signals.push("recognized_market_headers");
  return signals;
}

function validateCandidateObservations(observations: ParsedObservation[], expectedMarketCount: number): void {
  if (observations.length < 10) throw new Error("too few wholesale observations");
  const markets = new Set(observations.map((observation) => observation.marketLabel));
  if (markets.size < Math.min(3, expectedMarketCount)) throw new Error(`observations cover only ${markets.size} market columns`);
  if (observations.some((observation) => (
    !Number.isFinite(observation.minValueMinor)
    || !Number.isFinite(observation.maxValueMinor)
    || observation.minValueMinor <= 0
    || observation.minValueMinor > observation.maxValueMinor
    || !hartiDate(observation.date)
    || !observation.itemLabel.trim()
  ))) {
    throw new Error("candidate observations failed semantic validation");
  }
}

function canonicalMarket(value: string): string | undefined {
  return marketAliases.get(normalizeText(value));
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function boundedConfidence(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

function compactReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^(?:SOURCE_TEMPLATE_CHANGED|UNSUPPORTED_DOCUMENT):\s*/u, "").slice(0, 180);
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

  if (observations.length < 10) throw new Error("too few wholesale observations");
  return observations;
}

function hartiDate(value: string): string | undefined {
  const parts = value.trim().match(/^(?:(\d{4})[./-](\d{1,2})[./-](\d{1,2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4}))$/u);
  if (!parts) return undefined;
  const [year, month, day] = parts[1] ? [parts[1], parts[2], parts[3]] : [parts[6], parts[5], parts[4]];
  const date = `${year}-${month!.padStart(2, "0")}-${day!.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

function datesInText(value: string): string[] {
  return [...value.matchAll(/\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{4}/gu)].flatMap((match) => {
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
