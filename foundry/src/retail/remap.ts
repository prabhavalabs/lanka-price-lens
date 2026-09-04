import type { MappingBundle, SourceManifest } from "@lanka-pricelens/shared";

import { finishRun, startRun, syncSource, type OperationalDatabase } from "../db.ts";
import { canonicalizeArtifact } from "../mapping.ts";
import { executeLoggedStage, retailCaptureStages } from "../pipeline.ts";
import { pendingCanonicalization, retailCanonicalizeOptions, retailParserVersion } from "./capture.ts";
import type { RetailAdapter } from "./types.ts";

export type RemapOptions = {
  /** How many trading days back to look for stored snapshots. */
  days?: number | undefined;
  now?: Date | undefined;
  /** Re-promote even snapshots already promoted under the current bundle version. */
  force?: boolean | undefined;
};

export type RemapResult = {
  runId: string | null;
  status: "succeeded" | "skipped" | "failed";
  artifacts: number;
  promoted: number;
  unmapped: number;
  message: string | null;
};

type ArtifactRow = { id: string; mapping_version: string | null; observed_from: string; rows: number };

/**
 * Re-promotes the snapshots a source stored over the last `days` through its current
 * bundle. Run it after a bundle gains labels or patterns so prices already captured
 * appear without waiting for the next capture. Snapshots promoted under this bundle
 * version are skipped unless `force` is set; each source runs under its own run lease.
 */
export async function remapRecentSnapshots<S>(
  database: OperationalDatabase,
  manifest: SourceManifest,
  adapter: RetailAdapter<S>,
  bundle: MappingBundle,
  options: RemapOptions = {},
): Promise<RemapResult> {
  syncSource(database, manifest);
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - Math.max(1, options.days ?? 7) * 86_400_000).toISOString().slice(0, 10);
  const stored = database
    .prepare(
      `SELECT artifact.id, artifact.mapping_version, publication.observed_from,
              (SELECT COUNT(*) FROM staging_observation so WHERE so.artifact_id = artifact.id AND so.status != 'stale') AS rows
       FROM source_artifact artifact
       JOIN source_publication publication ON publication.id = artifact.publication_id
       WHERE publication.source_id = ? AND publication.observed_from >= ? AND artifact.status IN ('parsed', 'canonicalized')
       ORDER BY publication.observed_from, artifact.fetched_at`,
    )
    .all(manifest.id, since) as ArtifactRow[];
  const artifacts = stored.filter((artifact) => artifact.rows > 0 && (options.force || pendingCanonicalization(database, artifact.id, bundle)));
  if (!artifacts.length) return { runId: null, status: "skipped", artifacts: 0, promoted: 0, unmapped: 0, message: `Every snapshot since ${since} is already promoted under ${bundle.mapping_version}` };

  const run = startRun(database, { sourceId: manifest.id, trigger: "manual", workflow: "retail_capture", leaseMinutes: 30 });
  if (!run.started) return { runId: run.id, status: "skipped", artifacts: 0, promoted: 0, unmapped: 0, message: "Another run for this source is still active" };
  const totals = { promoted: 0, unmapped: 0, quarantined: 0 };
  try {
    await executeLoggedStage(database, run.id, "canonicalize_data", artifacts.reduce((sum, artifact) => sum + artifact.rows, 0), { remap: true, artifacts: artifacts.map((artifact) => artifact.id), since }, () => {
      for (const artifact of artifacts) {
        const result = canonicalizeArtifact(database, run.id, artifact.id, bundle, retailParserVersion(adapter), retailCanonicalizeOptions);
        database.prepare("UPDATE source_artifact SET status = 'canonicalized', mapping_version = ? WHERE id = ?").run(bundle.mapping_version, artifact.id);
        totals.promoted += result.accepted + result.corrected + result.historical;
        totals.unmapped += result.unmapped;
        totals.quarantined += result.quarantined;
      }
      return { outputCount: totals.promoted, warningCount: totals.quarantined, output: { ...totals, artifacts: artifacts.length, mapping_version: bundle.mapping_version } };
    }, retailCaptureStages);
    finishRun(database, run.id, "succeeded");
    return { runId: run.id, status: "succeeded", artifacts: artifacts.length, promoted: totals.promoted, unmapped: totals.unmapped, message: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(database, run.id, "failed", { code: "REMAP_FAILED", message });
    return { runId: run.id, status: "failed", artifacts: artifacts.length, promoted: totals.promoted, unmapped: totals.unmapped, message };
  }
}
