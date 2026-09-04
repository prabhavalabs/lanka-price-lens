import type { RetailAdapterKind, SourceManifest } from "@lanka-pricelens/shared";

import { cargillsAdapter } from "./adapters/cargills.ts";
import { glomarkAdapter } from "./adapters/glomark.ts";
import { keellsAdapter } from "./adapters/keells.ts";
import { sparAdapter } from "./adapters/spar.ts";
import type { BaseSettings } from "./settings.ts";
import type { RetailAdapter } from "./types.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const retailAdapters: Record<RetailAdapterKind, RetailAdapter<any>> = {
  spar_shopify: sparAdapter,
  glomark_html: glomarkAdapter,
  keells_api: keellsAdapter,
  cargills_api: cargillsAdapter,
};

/** Every adapter's settings extend the shared base, so callers can run any adapter through the same capture. */
export type AnyRetailAdapter = RetailAdapter<BaseSettings>;

export function retailAdapterFor(manifest: Pick<SourceManifest, "adapter">): AnyRetailAdapter | null {
  if (!manifest.adapter) return null;
  return (retailAdapters[manifest.adapter.kind] as AnyRetailAdapter | undefined) ?? null;
}

export { colomboDay, pendingCanonicalization, resumeSourceCapture, runRetailCapture, type RetailCaptureOptions, type RetailCaptureResult, type RetailCaptureStatus } from "./capture.ts";
export { remapRecentSnapshots, type RemapOptions, type RemapResult } from "./remap.ts";
export { clearAdapterSettings, parseSettings, readAdapterOverrides, resolveAdapterSettings, saveAdapterSettings, SettingsError, settingsJsonSchema, type BaseSettings } from "./settings.ts";
export type { NormalizedRecord, RetailAdapter, SnapshotPayload } from "./types.ts";
