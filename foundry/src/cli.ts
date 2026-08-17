import { scryptSync, randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { openOperationalDatabase } from "./db.ts";
import { canonicalizeRun } from "./mapping.ts";
import { readMappingBundle, readSourceManifest } from "./manifest.ts";
import { runIngestion } from "./pipeline.ts";
import { buildRelease } from "./release.ts";

const [command, ...arguments_] = process.argv.slice(2);

if (command === "hash-password") {
  const password = arguments_[0];
  if (!password || password.length < 12) throw new Error("Password must contain at least 12 characters");
  const salt = randomBytes(16).toString("hex");
  console.log(`scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`);
} else if (command === "init") {
  openOperationalDatabase(databasePath()).close();
  console.log(`Initialized ${databasePath()}`);
} else if (command === "ingest") {
  const manifestPath = valueOf("--manifest") ?? resolve(process.cwd(), "../data/manifests/harti_daily_food_prices.json");
  const manifest = await readSourceManifest(manifestPath);
  const database = openOperationalDatabase(databasePath());
  try {
    const trigger = arguments_.includes("--backfill") ? "backfill" : arguments_.includes("--manual") ? "manual" : "scheduled";
    const from = dateValue("--from");
    const to = dateValue("--to");
    if (from && to && from > to) throw new Error("--from must not be later than --to");
    const result = await runIngestion(database, manifest, { trigger, from, to });
    console.log(JSON.stringify(result));
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
  console.error("Usage: foundry <init|ingest|canonicalize|release build|hash-password> [options]");
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
