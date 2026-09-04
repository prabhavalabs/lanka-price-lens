import { hartiArchiveObjectKey } from "@lanka-pricelens/shared/harti-archive";
import type { DocumentAdapterKind, SourceManifest } from "@lanka-pricelens/shared";

import { discoverHartiDaily, HartiParseError, parseHartiWholesaleWithDiagnostics } from "../harti.ts";
import { cbslDailyPriceAdapter } from "./cbsl.ts";
import { dcsWeeklyRetailAdapter } from "./dcs.ts";
import { DocumentParseError, type DocumentAdapter } from "./types.ts";

/** HARTI daily food commodity bulletins, the original source, wrapped in the adapter contract. */
export const hartiDailyAdapter: DocumentAdapter = {
  kind: "harti_daily",
  label: "HARTI Daily Food Commodities Bulletin",
  description: "Lists the bulletins on the HARTI daily price page and reads the wholesale market grid.",
  parserVersion: "harti-adaptive@2",
  discover: async (context) => discoverHartiDaily(context.html, context.manifest.landing_url, context.range),
  archiveKey: (publication) => hartiArchiveObjectKey(publication),
  parse(items) {
    const parsed = parseHartiWholesaleWithDiagnostics(items);
    return {
      observations: parsed.observations,
      strategy: parsed.diagnostics.strategy,
      confidence: parsed.diagnostics.confidence,
      warnings: parsed.diagnostics.warnings,
      page: parsed.diagnostics.page,
      signals: { ...parsed.diagnostics.signals, rejected_candidates: parsed.diagnostics.rejectedCandidates },
    };
  },
};

export const documentAdapters: Record<DocumentAdapterKind, DocumentAdapter> = {
  harti_daily: hartiDailyAdapter,
  cbsl_daily_price: cbslDailyPriceAdapter,
  dcs_weekly_retail: dcsWeeklyRetailAdapter,
};

export function documentAdapterFor(manifest: Pick<SourceManifest, "document_adapter">): DocumentAdapter {
  return documentAdapters[manifest.document_adapter ?? "harti_daily"];
}

/** Quarantine code for a parse failure raised by any adapter, or null for ordinary errors. */
export function documentParseCode(error: unknown): string | null {
  if (error instanceof DocumentParseError || error instanceof HartiParseError) return error.code;
  return null;
}

export function documentParseDetails(error: unknown): Record<string, unknown> {
  if (error instanceof DocumentParseError) return error.details;
  if (error instanceof HartiParseError) return { rejected_candidates: error.rejectedCandidates };
  return {};
}

export { DocumentParseError } from "./types.ts";
export type { DiscoveryContext, DocumentAdapter, DocumentParseResult } from "./types.ts";
