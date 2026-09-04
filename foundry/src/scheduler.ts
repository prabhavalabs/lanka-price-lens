import { hostname } from "node:os";

import type { MappingBundle, SourceManifest } from "@lanka-pricelens/shared";

import type { OperationalDatabase } from "./db.ts";
import { singleSourceCatalog, type SourceCatalog } from "./manifest.ts";
import { schedulerHeartbeat, schedulerTick } from "./workflows.ts";

export function startScheduler(database: OperationalDatabase, sources: SourceCatalog | SourceManifest, mappingBundle?: MappingBundle): () => void {
  const catalog = "entries" in sources ? sources : singleSourceCatalog(sources, mappingBundle);
  const instanceId = `${hostname()}:${process.pid}`;
  const intervalMilliseconds = positiveInteger(process.env.LPL_SCHEDULER_INTERVAL_MS, 15_000);
  let running = false;
  let stopped = false;

  const run = async () => {
    if (running || stopped) return;
    running = true;
    try {
      await schedulerTick(database, catalog, instanceId, new Date());
    } catch (error) {
      schedulerHeartbeat(database, instanceId, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMilliseconds);
  return () => {
    stopped = true;
    clearInterval(timer);
    schedulerHeartbeat(database, instanceId, { status: "stopping" });
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : fallback;
}
