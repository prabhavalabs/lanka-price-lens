import { scryptSync, randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { configuredArchiveStorage } from "./archive-storage.ts";
import { openOperationalDatabase } from "./db.ts";
import { canonicalizeRun } from "./mapping.ts";
import { readMappingBundle, readSourceCatalog, readSourceManifest, singleSourceCatalog, type SourceCatalog } from "./manifest.ts";
import { runSourceSync } from "./pipeline.ts";
import { retailAdapterFor, runRetailCapture } from "./retail/index.ts";
import { buildRelease } from "./release.ts";
import { startScheduler } from "./scheduler.ts";

const [command, ...arguments_] = process.argv.slice(2);

if (command === "hash-password") {
  const password = arguments_[0];
  if (!password || password.length < 8) throw new Error("Password must contain at least 8 characters");
  const salt = randomBytes(16).toString("hex");
  console.log(`scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`);
} else if (command === "init") {
  openOperationalDatabase(databasePath()).close();
  console.log(`Initialized ${databasePath()}`);
} else if (command === "sync" || command === "ingest") {
  // One PDF source with --source <id>; otherwise every enabled PDF source in turn (what the production timer runs).
  const catalog = await loadCatalog();
  const requested = valueOf("--source");
  const entries = requested
    ? [catalog.find(requested) ?? (() => { throw new Error(`Unknown source ${requested}`); })()]
    : catalog.entries.filter((entry) => !entry.manifest.adapter && entry.manifest.enabled);
  if (!entries.length) throw new Error("No PDF bulletin source is configured");
  const database = openOperationalDatabase(databasePath());
  try {
    const trigger = arguments_.includes("--backfill") ? "backfill" : arguments_.includes("--manual") ? "manual" : "scheduled";
    const from = dateValue("--from");
    const to = dateValue("--to");
    if (from && to && from > to) throw new Error("--from must not be later than --to");
    for (const { manifest, mappingBundle } of entries) {
      try {
        const result = await runSourceSync(database, manifest, { trigger, from, to, mappingBundle });
        console.log(JSON.stringify({ source: manifest.id, ...result }));
        if (result.status !== "succeeded") process.exitCode = 1;
        if (result.processingRunIds.length) {
          const placeholders = result.processingRunIds.map(() => "?").join(",");
          const failed = database
            .prepare(`SELECT COUNT(*) AS count FROM ingest_run WHERE id IN (${placeholders}) AND status != 'succeeded'`)
            .get(...result.processingRunIds) as { count: number };
          if (failed.count) process.exitCode = 1;
        }
      } catch (error) {
        // One source failing must not stop the others; the run row already records the failure.
        console.log(JSON.stringify({ source: manifest.id, status: "failed", message: error instanceof Error ? error.message : String(error) }));
        process.exitCode = 1;
      }
    }
  } finally {
    database.close();
  }
} else if (command === "scheduler") {
  const catalog = await loadCatalog();
  const database = openOperationalDatabase(databasePath());
  const stop = startScheduler(database, catalog);
  const shutdown = () => {
    stop();
    database.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(JSON.stringify({ status: "online", service: "scheduler", database: databasePath(), sources: catalog.entries.map((entry) => entry.manifest.id) }));
} else if (command === "capture") {
  // One retailer with --source <id>, or every enabled retail source with --all (used by the production timer).
  const catalog = await loadCatalog();
  const all = arguments_.includes("--all");
  const entries = all
    ? catalog.entries.filter((entry) => entry.manifest.enabled && retailAdapterFor(entry.manifest))
    : [catalog.find(requiredValue("--source")) ?? (() => { throw new Error("Unknown source; pass --source <manifest id> or --all"); })()];
  if (!entries.length) throw new Error("No retail sources are configured");
  const archive = arguments_.includes("--no-archive") ? undefined : await configuredArchiveStorage();
  const database = openOperationalDatabase(databasePath());
  try {
    for (const entry of entries) {
      const adapter = retailAdapterFor(entry.manifest);
      if (!adapter) throw new Error(`Source ${entry.manifest.id} has no retail adapter`);
      const result = await runRetailCapture(database, entry.manifest, adapter, {
        trigger: all ? "scheduled" : "manual",
        archive,
        mappingBundle: entry.mappingBundle,
        captureDate: dateValue("--date"),
      });
      console.log(JSON.stringify({ source: entry.manifest.id, ...result }));
      // A paused source is expected to skip; anything else short of success fails the command.
      if (result.status !== "succeeded" && result.code !== "CAPTURE_PAUSED") process.exitCode = 1;
    }
  } finally {
    database.close();
  }
} else if (command === "canonicalize") {
  const runId = requiredValue("--run");
  const bundle = await readMappingBundle(requiredValue("--mappings"));
  const database = openOperationalDatabase(databasePath());
  try {
    console.log(JSON.stringify(canonicalizeRun(database, runId, bundle, requiredValue("--parser-version"))));
  } finally {
    database.close();
  }
} else if (command === "release" && arguments_[0] === "build") {
  const database = openOperationalDatabase(databasePath());
  try {
    console.log(
      JSON.stringify(
        buildRelease(database, {
          dataVersion: requiredValue("--version"),
          outputRoot: resolve(valueOf("--output") ?? resolve(process.cwd(), "../data/releases")),
          builtAt: new Date().toISOString(),
          buildCommit: requiredValue("--commit"),
          notes: requiredValue("--notes"),
          actor: requiredValue("--actor"),
        }),
      ),
    );
  } finally {
    database.close();
  }
} else {
  console.error("Usage: foundry <init|sync|ingest|scheduler|canonicalize|release build|hash-password> [options]");
  process.exitCode = 1;
}

function requiredValue(name: string): string {
  const value = valueOf(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function valueOf(name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function dateValue(name: string): string | undefined {
  const value = valueOf(name);
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function databasePath(): string {
  return resolve(process.env.LPL_DATABASE_PATH ?? resolve(process.cwd(), "../data/runtime/operations.sqlite"));
}

/** One manifest when --manifest or LPL_SOURCE_MANIFEST_PATH is given; otherwise every manifest in the manifests directory. */
async function loadCatalog(): Promise<SourceCatalog> {
  const single = valueOf("--manifest") ?? process.env.LPL_SOURCE_MANIFEST_PATH;
  if (single) return singleSourceCatalog(await readSourceManifest(single), await readMappingBundle(mappingPath()));
  return readSourceCatalog(
    resolve(valueOf("--manifests") ?? process.env.LPL_MANIFESTS_DIR ?? resolve(process.cwd(), "../data/manifests")),
    resolve(valueOf("--mappings-dir") ?? process.env.LPL_MAPPINGS_DIR ?? resolve(process.cwd(), "../data/mappings")),
  );
}

function mappingPath(): string {
  return resolve(
    valueOf("--mappings") ??
      process.env.LPL_MAPPING_BUNDLE_PATH ??
      resolve(process.cwd(), "../data/mappings/harti_daily_food_prices.json"),
  );
}
