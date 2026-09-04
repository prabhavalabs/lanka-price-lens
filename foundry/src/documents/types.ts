import { createHash } from "node:crypto";

import type { DocumentAdapterKind, SourceManifest } from "@lanka-pricelens/shared";

import type { ParsedObservation, Publication } from "../harti.ts";
import type { TextItem } from "../pdf.ts";

export type { ParsedObservation, Publication };

export type LogLevel = "info" | "warning" | "error";

/** What a discovery step can use: the landing page, the manifest, the requested range, and HTTP with retries. */
export type DiscoveryContext = {
  manifest: SourceManifest;
  html: string;
  range: { from?: string | undefined; to?: string | undefined };
  request: typeof fetch;
  /** Retries with the manifest's attempt count and request interval. */
  fetchWithRetry: (url: string, init?: RequestInit) => Promise<Response>;
  readBody: (response: Response, maximumBytes: number) => Promise<Uint8Array>;
  log: (level: LogLevel, message: string, data?: Record<string, unknown>) => void;
  now: Date;
};

export type DocumentParseResult = {
  observations: ParsedObservation[];
  /** Which layout the parser recognised; recorded on the artifact for lineage. */
  strategy: string;
  /** 0..1, share of candidate rows that parsed cleanly. */
  confidence: number;
  warnings: string[];
  page: number | null;
  signals: Record<string, unknown>;
};

/**
 * A document adapter owns one publisher's PDF format: how new documents are
 * found, where their originals are filed, and how a document's text becomes
 * observations. The document pipeline (discover, archive, parse, validate,
 * promote) is shared by every adapter.
 */
export type DocumentAdapter = {
  kind: DocumentAdapterKind;
  label: string;
  description: string;
  /** Bumped when parsing changes materially; part of the canonical lineage version. */
  parserVersion: string;
  discover: (context: DiscoveryContext) => Promise<Publication[]>;
  archiveKey: (publication: Pick<Publication, "title" | "date" | "downloadUrl">) => string;
  parse: (items: TextItem[], publication: { title: string; date: string }) => DocumentParseResult;
};

export type DocumentParseCode = "SOURCE_TEMPLATE_CHANGED" | "UNSUPPORTED_DOCUMENT";

/** Thrown when a document is readable but its layout is not the one the adapter knows; the pipeline quarantines it for review. */
export class DocumentParseError extends Error {
  readonly code: DocumentParseCode;
  readonly details: Record<string, unknown>;

  constructor(code: DocumentParseCode, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = "DocumentParseError";
    this.code = code;
    this.details = details;
  }
}

export type Line = { page: number; y: number; cells: TextItem[] };

/** Groups text items into lines by page and vertical position, cells left to right, lines top to bottom. */
export function linesOf(items: TextItem[], tolerance = 3): Line[] {
  const lines: Line[] = [];
  const sorted = [...items].filter((item) => item.text.trim()).sort((left, right) => left.page - right.page || right.y - left.y || left.x - right.x);
  for (const item of sorted) {
    const current = lines.at(-1);
    if (current && current.page === item.page && Math.abs(current.y - item.y) <= tolerance) {
      current.cells.push(item);
      continue;
    }
    lines.push({ page: item.page, y: item.y, cells: [item] });
  }
  for (const line of lines) line.cells.sort((left, right) => left.x - right.x);
  return lines;
}

export function lineText(line: Line): string {
  return line.cells.map((cell) => cell.text.trim()).join(" ").replace(/\s+/gu, " ");
}

export function centerOf(item: TextItem): number {
  return item.x + item.width / 2;
}

/** Index of the nearest column centre within tolerance, or -1. */
export function nearestColumn(x: number, centers: number[], tolerance: number): number {
  let best = -1;
  let bestDistance = tolerance;
  centers.forEach((center, index) => {
    const distance = Math.abs(center - x);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

export function publicationKey(downloadUrl: string): string {
  return createHash("sha256").update(downloadUrl).digest("hex").slice(0, 24);
}

/** `sources/<publisher>/<series>/<yyyy>/<mm>/<date>/<filename>`, filename made safe for object storage. */
export function archiveObjectKey(prefix: string, publication: Pick<Publication, "title" | "date">): string {
  const filename = publication.title
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._()-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "document.pdf";
  return `${prefix}/${publication.date.slice(0, 4)}/${publication.date.slice(5, 7)}/${publication.date}/${filename}`;
}

export function inRange(date: string, range: { from?: string | undefined; to?: string | undefined }): boolean {
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

export function monthNumber(name: string): number | null {
  const lower = name.trim().toLowerCase().replace(/\.$/u, "");
  const index = monthNames.findIndex((month) => month === lower || month.slice(0, 3) === lower);
  return index === -1 ? null : index + 1;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
