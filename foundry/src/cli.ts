import { scryptSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { configuredArchiveStorage } from "./archive-storage.ts";
import { openOperationalDatabase } from "./db.ts";
import { canonicalizeRun, syncMappingBundle } from "./mapping.ts";
import { readMappingBundle, readSourceCatalog, readSourceManifest, singleSourceCatalog, type SourceCatalog } from "./manifest.ts";
import { processPendingArchives, recoverFailedProcessing, runSourceSync } from "./pipeline.ts";
import { exportSnapshot, remapRecentSnapshots, retailAdapterFor, runRetailCapture, snapshotFileSchema } from "./retail/index.ts";
import { retryPolicyFor, runWithRetry } from "./retry.ts";
import { connectWarehouse, migrateWarehouse, renderReportMarkdown, syncWarehouse, warehouseReport } from "./warehouse/index.ts";
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
        // Register the bundle first so vocabulary changes (new items, product settings) reach the operational store even on a day without new documents.
        if (mappingBundle) syncMappingBundle(database, mappingBundle);
        // An outage is retried after a cooldown, up to the manifest's policy; each attempt is its own run.
        const { result, attempts } = await runWithRetry(database, retryPolicyFor(manifest, retryOverrides()), { sourceId: manifest.id, workflow: "source_sync" },
          () => runSourceSync(database, manifest, { trigger, from, to, mappingBundle }), { log: logRetry });
        console.log(JSON.stringify({ source: manifest.id, ...result, attempts }));
        if (result.status !== "succeeded") process.exitCode = 1;
        // Documents that failed after parsing (a rejected bundle, a missing mapping) are retried now that the configuration may have changed.
        const recovery = await recoverFailedProcessing(database, manifest, { mappingBundle });
        if (recovery.retried.length) console.log(JSON.stringify({ source: manifest.id, recovery }));
        if (recovery.failed.length) process.exitCode = 1;
        // Archived documents whose processing never ran (an interrupted sync, an archive filled before processing existed)
        // or ran without a bundle are processed now, newest first, within a budget that keeps the timer run bounded.
        const pending = await processPendingArchives(database, manifest, { trigger, mappingBundle, limit: Number(valueOf("--process-limit") ?? 150), retry: retryPolicyFor(manifest, retryOverrides()), log: logRetry, paceMs: 250 });
        if (pending.candidates) console.log(JSON.stringify({ source: manifest.id, pending: { ...pending, runs: undefined } }));
        if (pending.failed) process.exitCode = 1;
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
      // An outage is retried after a cooldown, up to the manifest's policy; only the last attempt counts towards the breaker.
      const { result, attempts } = await runWithRetry(database, retryPolicyFor(entry.manifest, retryOverrides()), { sourceId: entry.manifest.id, workflow: "retail_capture" },
        ({ final }) => runRetailCapture(database, entry.manifest, adapter, {
          trigger: all ? "scheduled" : "manual",
          archive,
          mappingBundle: entry.mappingBundle,
          captureDate: dateValue("--date"),
          countFailure: final,
        }), { log: logRetry });
      console.log(JSON.stringify({ source: entry.manifest.id, ...result, attempts }));
      // A paused source is expected to skip; anything else short of success fails the command.
      if (result.status !== "succeeded" && result.code !== "CAPTURE_PAUSED") process.exitCode = 1;
    }
  } finally {
    database.close();
  }
} else if (command === "process") {
  // process [--source <id>] [--limit N] [--since yyyy-mm-dd]: process archived documents whose prices never landed.
  const catalog = await loadCatalog();
  const requested = valueOf("--source");
  const entries = requested
    ? [catalog.find(requested) ?? (() => { throw new Error(`Unknown source ${requested}`); })()]
    : catalog.entries.filter((entry) => !entry.manifest.adapter && entry.manifest.enabled);
  if (!entries.length) throw new Error("No PDF bulletin source is configured");
  const database = openOperationalDatabase(databasePath());
  try {
    const archive = await configuredArchiveStorage();
    const limit = Number(valueOf("--limit") ?? 200);
    const since = dateValue("--since");
    for (const { manifest, mappingBundle } of entries) {
      if (mappingBundle) syncMappingBundle(database, mappingBundle);
      const result = await processPendingArchives(database, manifest, {
        trigger: "manual",
        archive,
        mappingBundle,
        limit,
        since,
        retry: retryPolicyFor(manifest, retryOverrides()),
        log: logRetry,
        paceMs: 250,
        onProgress: (done, total) => { if (done % 25 === 0 || done === total) console.error(`${manifest.id}: ${done}/${total}`); },
      });
      console.log(JSON.stringify({ source: manifest.id, ...result, runs: result.runs.filter((run) => run.status !== "succeeded") }));
      if (result.failed) process.exitCode = 1;
    }
  } finally {
    database.close();
  }
} else if (command === "snapshot") {
  // snapshot export --source <id> --date <yyyy-mm-dd> [--out file] [--raw]: a stored snapshot as a portable file.
  // snapshot import --source <id> --file <file> [--no-archive]: file a snapshot captured elsewhere as if captured here.
  const action = arguments_[0];
  const catalog = await loadCatalog();
  const entry = catalog.find(requiredValue("--source")) ?? (() => { throw new Error("Unknown source; pass --source <manifest id>"); })();
  const database = openOperationalDatabase(databasePath());
  try {
    if (action === "export") {
      const date = dateValue("--date") ?? (() => { throw new Error("--date is required"); })();
      const snapshot = exportSnapshot(database, entry.manifest.id, date, { raw: arguments_.includes("--raw") });
      if (!snapshot) throw new Error(`No stored snapshot for ${entry.manifest.id} on ${date}`);
      const out = valueOf("--out") ?? `${entry.manifest.id}-${date}.snapshot.json`;
      writeFileSync(out, `${JSON.stringify(snapshot)}\n`);
      console.log(JSON.stringify({ source: entry.manifest.id, capture_date: date, records: snapshot.records.length, file: resolve(out) }));
    } else if (action === "import") {
      const adapter = retailAdapterFor(entry.manifest);
      if (!adapter) throw new Error(`Source ${entry.manifest.id} has no retail adapter`);
      const snapshot = snapshotFileSchema.parse(JSON.parse(readFileSync(requiredValue("--file"), "utf8")));
      if (snapshot.source_id !== entry.manifest.id) throw new Error(`Snapshot belongs to ${snapshot.source_id}, not ${entry.manifest.id}`);
      const archive = arguments_.includes("--no-archive") ? undefined : await configuredArchiveStorage();
      const result = await runRetailCapture(database, entry.manifest, adapter, {
        trigger: "import",
        archive,
        mappingBundle: entry.mappingBundle,
        captureDate: snapshot.capture_date,
        snapshot: { records: snapshot.records, payload: { fetchedAt: snapshot.captured_at, requests: 0, data: { imported_from: snapshot.adapter, records: snapshot.records.length } } },
      });
      console.log(JSON.stringify({ source: entry.manifest.id, ...result }));
      if (result.status !== "succeeded") process.exitCode = 1;
    } else {
      throw new Error("Usage: snapshot export --source <id> --date <yyyy-mm-dd> [--out file] [--raw] | snapshot import --source <id> --file <file>");
    }
  } finally {
    database.close();
  }
} else if (command === "remap") {
  // Re-promote stored retail snapshots through the current bundles after a mapping change: remap --source <id> | --all [--days N] [--force]
  const catalog = await loadCatalog();
  const all = arguments_.includes("--all");
  const entries = all
    ? catalog.entries.filter((entry) => entry.manifest.enabled && retailAdapterFor(entry.manifest))
    : [catalog.find(requiredValue("--source")) ?? (() => { throw new Error("Unknown source; pass --source <manifest id> or --all"); })()];
  // A deployment without retail sources has nothing to re-promote; that is not a failure.
  if (!entries.length) console.log(JSON.stringify({ status: "skipped", message: "No retail sources are configured" }));
  const days = Number(valueOf("--days") ?? 7);
  if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive whole number");
  const database = openOperationalDatabase(databasePath());
  try {
    for (const entry of entries) {
      const adapter = retailAdapterFor(entry.manifest);
      if (!adapter || !entry.mappingBundle) {
        console.log(JSON.stringify({ source: entry.manifest.id, status: "skipped", message: adapter ? "No mapping bundle" : "Not a retail source" }));
        continue;
      }
      const result = await remapRecentSnapshots(database, entry.manifest, adapter, entry.mappingBundle, { days, force: arguments_.includes("--force") });
      console.log(JSON.stringify({ source: entry.manifest.id, ...result }));
      if (result.status === "failed") process.exitCode = 1;
    }
  } finally {
    database.close();
  }
} else if (command === "warehouse") {
  // warehouse migrate | sync [--full] | report [--json]; the PostgreSQL URL comes from --url or LPL_POSTGRES_URL.
  const action = arguments_[0];
  const url = valueOf("--url") ?? process.env.LPL_POSTGRES_URL;
  if (!url) throw new Error("Set LPL_POSTGRES_URL or pass --url postgres://…");
  if (!action || !["migrate", "sync", "report"].includes(action)) throw new Error("Usage: warehouse migrate | sync [--full] | report [--json]");
  const client = await connectWarehouse(url);
  try {
    if (action === "migrate") {
      console.log(JSON.stringify({ migrated: await migrateWarehouse(client) }));
    } else if (action === "sync") {
      const database = openOperationalDatabase(databasePath());
      try {
        const result = await syncWarehouse(database, client, {
          full: arguments_.includes("--full"),
          log: (level, message, data) => console.error(JSON.stringify({ level, message, ...data })),
        });
        console.log(JSON.stringify(result));
      } finally {
        database.close();
      }
    } else {
      const report = await warehouseReport(client);
      console.log(arguments_.includes("--json") ? JSON.stringify(report, null, 2) : renderReportMarkdown(report));
    }
  } finally {
    await client.close();
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
  console.error("Usage: foundry <init|sync|ingest|process|capture|remap|snapshot|warehouse|scheduler|canonicalize|release build|hash-password> [options]");
  process.exitCode = 1;
}

/** `--retry-attempts N` and `--retry-cooldown-minutes M` override the manifest's retry policy for this invocation. */
function retryOverrides(): { attempts?: number | undefined; cooldownMinutes?: number | undefined } {
  const attempts = valueOf("--retry-attempts");
  const cooldown = valueOf("--retry-cooldown-minutes");
  return { attempts: attempts === undefined ? undefined : Number(attempts), cooldownMinutes: cooldown === undefined ? undefined : Number(cooldown) };
}

function logRetry(message: string, data: Record<string, unknown>): void {
  console.error(JSON.stringify({ level: "warning", message, ...data }));
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
/**
 * The catalogue of every configured source. A manifests directory (--manifests or
 * LPL_MANIFESTS_DIR) wins over a single manifest (--manifest or
 * LPL_SOURCE_MANIFEST_PATH): deployments set both so that older single-source
 * tooling keeps working, and the multi-source commands (sync, capture --all,
 * remap --all) must see every source, not only the first one that was configured.
 */
async function loadCatalog(): Promise<SourceCatalog> {
  const explicitSingle = valueOf("--manifest");
  const directory = valueOf("--manifests") ?? process.env.LPL_MANIFESTS_DIR;
  const single = explicitSingle ?? (directory ? undefined : process.env.LPL_SOURCE_MANIFEST_PATH);
  if (single) return singleSourceCatalog(await readSourceManifest(single), await readMappingBundle(mappingPath()));
  return readSourceCatalog(
    resolve(directory ?? resolve(process.cwd(), "../data/manifests")),
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
