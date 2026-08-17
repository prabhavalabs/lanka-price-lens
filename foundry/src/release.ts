import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

import { sourceManifestSchema } from "@lanka-pricelens/shared";
import Database from "better-sqlite3";

import { newId, type OperationalDatabase } from "./db.ts";

type ReleaseRow = {
  id: string;
  run_id: string;
  source_publication_id: string;
  source_artifact_id: string;
  item_id: string;
  market_id: string;
  price_type: string;
  currency: string;
  value_kind: string;
  min_value_minor: number;
  max_value_minor: number;
  normalized_min_value_minor: number;
  normalized_max_value_minor: number;
  source_quantity: string;
  source_unit: string;
  normalized_quantity: string;
  normalized_unit: string;
  conversion_rule_id: string;
  observed_from: string;
  observed_to: string;
  source_row_ref: string;
  confidence: string;
  comparability_key: string;
  parser_version: string;
  mapping_version: string;
  supersedes_id: string | null;
  item_label_en: string;
  item_label_si: string | null;
  item_label_ta: string | null;
  market_label_en: string;
  market_label_si: string | null;
  market_label_ta: string | null;
  source_id: string;
  source_name: string;
  source_manifest_json: string;
  source_publication_key: string;
  publication_title: string;
  source_url: string;
  published_at: string | null;
  fetched_at: string;
  source_artifact_sha256: string;
};

type Artifact = { filename: string; media_type: string; byte_size: number; sha256: string };

const publicColumns = [
  "id", "item_id", "item_label_en", "item_label_si", "item_label_ta", "market_id", "market_label_en",
  "market_label_si", "market_label_ta", "price_type", "currency", "value_kind", "min_value_minor",
  "max_value_minor", "normalized_min_value_minor", "normalized_max_value_minor", "source_quantity", "source_unit",
  "normalized_quantity", "normalized_unit", "observed_from", "observed_to", "confidence", "comparability_key", "source_id", "source_name",
  "source_publication_id", "source_publication_key", "source_row_ref", "source_url", "published_at", "fetched_at",
  "parser_version", "mapping_version", "supersedes_id",
  "source_artifact_sha256",
] as const;

export function buildRelease(
  database: OperationalDatabase,
  options: {
    dataVersion: string;
    outputRoot: string;
    builtAt: string;
    buildCommit: string;
    notes: string;
    actor: string;
  },
): { dataVersion: string; path: string; recordCount: number; manifestSha256: string } {
  const versionDate = options.dataVersion.split(".", 1)[0] ?? "";
  if (!/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(options.dataVersion) || !validIsoDate(versionDate)) {
    throw new Error("INVALID_DATA_VERSION");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(options.builtAt) ||
    Number.isNaN(new Date(options.builtAt).valueOf())
  ) {
    throw new Error("INVALID_BUILD_TIME");
  }
  if (!/^[0-9a-f]{7,64}$/u.test(options.buildCommit)) throw new Error("INVALID_BUILD_COMMIT");
  if (!options.notes.trim()) throw new Error("RELEASE_NOTES_REQUIRED");
  if (!options.actor.trim()) throw new Error("RELEASE_ACTOR_REQUIRED");
  if (database.prepare("SELECT 1 FROM data_release WHERE data_version = ?").get(options.dataVersion)) throw new Error("DATA_VERSION_EXISTS");

  const records = database
    .prepare(
      `SELECT po.*, i.canonical_label_en AS item_label_en, i.canonical_label_si AS item_label_si,
       i.canonical_label_ta AS item_label_ta, m.label_en AS market_label_en,
       m.label_si AS market_label_si, m.label_ta AS market_label_ta,
       sp.source_id, s.name AS source_name, s.manifest_json AS source_manifest_json,
       sp.source_publication_key, sp.title AS publication_title, sp.download_url AS source_url,
       sp.published_at, sa.fetched_at, sa.sha256 AS source_artifact_sha256
       FROM price_observation po
       JOIN item i ON i.id = po.item_id
       JOIN market m ON m.id = po.market_id
       JOIN source_publication sp ON sp.id = po.source_publication_id
       JOIN source s ON s.id = sp.source_id
       JOIN source_artifact sa ON sa.id = po.source_artifact_id
       WHERE po.status = 'active'
       ORDER BY po.observed_from, po.item_id, po.market_id, po.id`,
    )
    .all() as ReleaseRow[];
  if (!records.length) throw new Error("NO_ACTIVE_OBSERVATIONS");

  const buildDate = options.builtAt.slice(0, 10);
  const sourceManifests = new Map(
    records.map((record) => {
      const manifest = sourceManifestSchema.parse(JSON.parse(record.source_manifest_json));
      if (!manifest.enabled || !["approved_open", "approved_permission"].includes(manifest.rights_status) || manifest.review_due_at < buildDate) {
        throw new Error(`SOURCE_RIGHTS_BLOCKED:${manifest.id}`);
      }
      return [manifest.id, manifest] as const;
    }),
  );
  const runIds = [...new Set(records.map((record) => record.run_id))];
  // ponytail: zero-open-quarantine gate; add reviewed threshold overrides when stewardship exists.
  const openQuarantine = database
    .prepare(`SELECT COUNT(*) AS count FROM quarantine WHERE status = 'open' AND run_id IN (${runIds.map(() => "?").join(",")})`)
    .get(...runIds) as { count: number };
  if (openQuarantine.count) throw new Error("RELEASE_HAS_OPEN_QUARANTINE");

  const outputRoot = resolve(options.outputRoot);
  const target = resolve(outputRoot, options.dataVersion);
  if (!target.startsWith(`${outputRoot}${sep}`)) throw new Error("INVALID_RELEASE_PATH");
  if (existsSync(target)) throw new Error("RELEASE_PATH_EXISTS");
  mkdirSync(outputRoot, { recursive: true });
  const temporary = mkdtempSync(join(outputRoot, `.${options.dataVersion}-`));

  try {
    writePublicSqlite(join(temporary, "prices.sqlite"), options.dataVersion, records);
    writeFileSync(join(temporary, "observations.csv"), toCsv(records));
    writeFileSync(
      join(temporary, "observations.json"),
      `${JSON.stringify({ data_version: options.dataVersion, records: records.map(publicRecord) }, null, 2)}\n`,
    );
    writeFileSync(
      join(temporary, "NOTICE.txt"),
      [...sourceManifests.values()]
        .map((source) => `${source.name}\n${source.attribution_text}\nRights evidence: ${source.rights_evidence_ref}`)
        .join("\n\n"),
    );
    writeFileSync(join(temporary, "RELEASE_NOTES.md"), `# Release ${options.dataVersion}\n\n${options.notes.trim()}\n`);

    const primaryArtifacts = describeArtifacts(temporary, [
      ["prices.sqlite", "application/vnd.sqlite3"],
      ["observations.csv", "text/csv"],
      ["observations.json", "application/json"],
      ["NOTICE.txt", "text/plain"],
      ["RELEASE_NOTES.md", "text/markdown"],
    ]);
    const manifest = {
      data_version: options.dataVersion,
      schema_version: "1.0.0",
      built_at: options.builtAt,
      build_commit: options.buildCommit,
      record_count: records.length,
      coverage: {
        observed_from: records.reduce((minimum, record) => (record.observed_from < minimum ? record.observed_from : minimum), records[0]!.observed_from),
        observed_to: records.reduce((maximum, record) => (record.observed_to > maximum ? record.observed_to : maximum), records[0]!.observed_to),
      },
      sources: [...sourceManifests.values()].map((source) => ({
        id: source.id,
        rights_status: source.rights_status,
        rights_evidence_ref: source.rights_evidence_ref,
        attribution_text: source.attribution_text,
        publications: records
          .filter((record) => record.source_id === source.id)
          .map((record) => ({
            key: record.source_publication_key,
            artifact_sha256: record.source_artifact_sha256,
            fetched_at: record.fetched_at,
          }))
          .filter(
            (publication, index, all) =>
              all.findIndex(
                (candidate) => candidate.key === publication.key && candidate.artifact_sha256 === publication.artifact_sha256,
              ) === index,
          ),
      })),
      artifacts: primaryArtifacts,
    };
    writeFileSync(join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const withManifest = [
      ...primaryArtifacts,
      ...describeArtifacts(temporary, [["manifest.json", "application/json"]]),
    ];
    writeFileSync(
      join(temporary, "checksums.sha256"),
      `${withManifest.map((artifact) => `${artifact.sha256}  ${artifact.filename}`).join("\n")}\n`,
    );
    const artifacts = [
      ...withManifest,
      ...describeArtifacts(temporary, [["checksums.sha256", "text/plain"]]),
    ];
    const manifestSha256 = withManifest.find((artifact) => artifact.filename === "manifest.json")!.sha256;
    renameSync(temporary, target);

    try {
      database.transaction(() => {
        database
          .prepare(
            `INSERT INTO data_release
             (data_version, schema_version, status, built_at, manifest_sha256, release_path, notes, build_commit)
             VALUES (?, '1.0.0', 'built', ?, ?, ?, ?, ?)`,
          )
          .run(options.dataVersion, options.builtAt, manifestSha256, target, options.notes.trim(), options.buildCommit);
        const include = database.prepare("INSERT INTO release_observation (data_version, observation_id) VALUES (?, ?)");
        for (const record of records) include.run(options.dataVersion, record.id);
        const addArtifact = database.prepare(
          `INSERT INTO release_artifact (data_version, filename, media_type, byte_size, sha256)
           VALUES (?, ?, ?, ?, ?)`,
        );
        for (const artifact of artifacts) {
          addArtifact.run(options.dataVersion, artifact.filename, artifact.media_type, artifact.byte_size, artifact.sha256);
        }
        for (const runId of runIds) {
          database
            .prepare(
              `INSERT INTO run_stage (run_id, stage, status, started_at, finished_at, input_count, output_count)
               VALUES (?, 'release', 'succeeded', ?, ?, ?, ?)
               ON CONFLICT(run_id, stage) DO UPDATE SET status = 'succeeded', finished_at = excluded.finished_at,
                 input_count = excluded.input_count, output_count = excluded.output_count,
                 warning_count = 0, error_code = NULL, error_message = NULL`,
            )
            .run(
              runId,
              options.builtAt,
              options.builtAt,
              records.filter((record) => record.run_id === runId).length,
              records.filter((record) => record.run_id === runId).length,
            );
        }
        database
          .prepare(
            `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
             VALUES (?, ?, 'release.built', 'data_release', ?, ?, ?)`,
          )
          .run(
            newId("audit"),
            options.actor.trim(),
            options.dataVersion,
            JSON.stringify({ record_count: records.length, manifest_sha256: manifestSha256 }),
            options.builtAt,
          );
      })();
    } catch (error) {
      rmSync(target, { recursive: true });
      throw error;
    }
    return { dataVersion: options.dataVersion, path: target, recordCount: records.length, manifestSha256 };
  } finally {
    if (existsSync(temporary)) rmSync(temporary, { recursive: true });
  }
}

function writePublicSqlite(path: string, dataVersion: string, records: ReleaseRow[]): void {
  const database = new Database(path);
  database.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE observation (
      id TEXT PRIMARY KEY, item_id TEXT NOT NULL, item_label_en TEXT NOT NULL,
      item_label_si TEXT, item_label_ta TEXT, market_id TEXT NOT NULL,
      market_label_en TEXT NOT NULL, market_label_si TEXT, market_label_ta TEXT,
      price_type TEXT NOT NULL, currency TEXT NOT NULL, value_kind TEXT NOT NULL,
      min_value_minor INTEGER NOT NULL, max_value_minor INTEGER NOT NULL,
      normalized_min_value_minor INTEGER NOT NULL, normalized_max_value_minor INTEGER NOT NULL,
      source_quantity TEXT NOT NULL, source_unit TEXT NOT NULL, normalized_quantity TEXT NOT NULL,
      normalized_unit TEXT NOT NULL,
      observed_from TEXT NOT NULL, observed_to TEXT NOT NULL, confidence TEXT NOT NULL,
      comparability_key TEXT NOT NULL, source_id TEXT NOT NULL, source_name TEXT NOT NULL,
      source_publication_id TEXT NOT NULL, source_publication_key TEXT NOT NULL,
      source_row_ref TEXT NOT NULL, source_url TEXT NOT NULL, published_at TEXT,
      fetched_at TEXT NOT NULL, parser_version TEXT NOT NULL, mapping_version TEXT NOT NULL,
      supersedes_id TEXT, source_artifact_sha256 TEXT NOT NULL
    ) STRICT;
    CREATE INDEX observation_series_idx ON observation(comparability_key, observed_from);
  `);
  database.prepare("INSERT INTO metadata (key, value) VALUES ('data_version', ?), ('schema_version', '1.0.0')").run(dataVersion);
  const insert = database.prepare(
    `INSERT INTO observation (${publicColumns.join(",")}) VALUES (${publicColumns.map(() => "?").join(",")})`,
  );
  database.transaction(() => {
    for (const record of records) insert.run(...publicColumns.map((column) => record[column]));
  })();
  database.pragma("journal_mode = DELETE");
  database.close();
}

function toCsv(records: ReleaseRow[]): string {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return `${publicColumns.join(",")}\n${records.map((record) => publicColumns.map((column) => escape(record[column])).join(",")).join("\n")}\n`;
}

function publicRecord(record: ReleaseRow): Record<string, unknown> {
  return Object.fromEntries(publicColumns.map((column) => [column, record[column]]));
}

function describeArtifacts(directory: string, definitions: Array<[string, string]>): Artifact[] {
  return definitions.map(([filename, media_type]) => ({
    filename,
    media_type,
    byte_size: statSync(join(directory, filename)).size,
    sha256: createHash("sha256").update(readFileSync(join(directory, filename))).digest("hex"),
  }));
}

function validIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
