import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { RunStatus, SourceManifest, StageName } from "@lanka-pricelens/shared";

export type OperationalDatabase = Database.Database;

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function openOperationalDatabase(path: string): OperationalDatabase {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const database = new Database(path);
  database.pragma("foreign_keys = ON");
  database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  migrate(database);
  return database;
}

function migrate(database: OperationalDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS source (
      id TEXT PRIMARY KEY,
      manifest_json TEXT NOT NULL,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      landing_url TEXT NOT NULL,
      rights_status TEXT NOT NULL,
      rights_evidence_ref TEXT,
      reviewed_at TEXT NOT NULL,
      review_due_at TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      state TEXT NOT NULL,
      last_discovery_at TEXT,
      last_fetch_at TEXT,
      last_parse_at TEXT,
      last_release_at TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ingest_run (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES source(id),
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      requested_from TEXT,
      requested_to TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      heartbeat_at TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      discovered_count INTEGER NOT NULL DEFAULT 0,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      extracted_count INTEGER NOT NULL DEFAULT 0,
      parsed_count INTEGER NOT NULL DEFAULT 0,
      quarantined_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS ingest_run_source_started_idx
      ON ingest_run(source_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS run_stage (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      input_count INTEGER NOT NULL DEFAULT 0,
      output_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_message TEXT,
      UNIQUE(run_id, stage)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_publication (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES source(id),
      source_publication_key TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT,
      observed_from TEXT,
      observed_to TEXT,
      landing_url TEXT NOT NULL,
      download_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'discovered',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(source_id, source_publication_key)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_artifact (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL REFERENCES source_publication(id),
      requested_url TEXT NOT NULL,
      final_url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      sha256 TEXT NOT NULL,
      storage_ref TEXT,
      http_etag TEXT,
      http_last_modified TEXT,
      status TEXT NOT NULL,
      UNIQUE(publication_id, sha256)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS extracted_text_item (
      artifact_id TEXT NOT NULL REFERENCES source_artifact(id),
      page_number INTEGER NOT NULL CHECK (page_number > 0),
      item_index INTEGER NOT NULL CHECK (item_index >= 0),
      text TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      PRIMARY KEY (artifact_id, page_number, item_index)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS staging_observation (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      artifact_id TEXT NOT NULL REFERENCES source_artifact(id),
      source_row_ref TEXT NOT NULL,
      source_item_label TEXT NOT NULL,
      source_market_label TEXT NOT NULL,
      source_date TEXT NOT NULL,
      price_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      source_quantity TEXT NOT NULL,
      source_unit TEXT NOT NULL,
      min_value_minor INTEGER NOT NULL,
      max_value_minor INTEGER NOT NULL,
      status TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      UNIQUE(artifact_id, source_row_ref, source_market_label)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS quarantine (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      artifact_id TEXT REFERENCES source_artifact(id),
      reason_code TEXT NOT NULL,
      source_row_ref TEXT,
      details_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution_note TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS data_release (
      data_version TEXT PRIMARY KEY,
      schema_version TEXT NOT NULL,
      status TEXT NOT NULL,
      built_at TEXT NOT NULL,
      released_at TEXT,
      manifest_sha256 TEXT,
      release_path TEXT NOT NULL,
      notes TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS audit_event (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS item (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      canonical_label_en TEXT NOT NULL,
      canonical_label_si TEXT,
      canonical_label_ta TEXT,
      variety TEXT,
      grade TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS market (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label_en TEXT NOT NULL,
      label_si TEXT,
      label_ta TEXT,
      pcode TEXT,
      scope_note TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    ) STRICT;

    CREATE TABLE IF NOT EXISTS unit_conversion_rule (
      id TEXT PRIMARY KEY,
      source_unit TEXT NOT NULL,
      normalized_unit TEXT NOT NULL,
      factor_numerator INTEGER NOT NULL CHECK (factor_numerator > 0),
      factor_denominator INTEGER NOT NULL CHECK (factor_denominator > 0),
      rounding_mode TEXT NOT NULL,
      mapping_version TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_item_mapping (
      source_id TEXT NOT NULL REFERENCES source(id),
      source_label TEXT NOT NULL,
      item_id TEXT NOT NULL REFERENCES item(id),
      mapping_version TEXT NOT NULL,
      reviewed_by TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      PRIMARY KEY (source_id, source_label)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS source_market_mapping (
      source_id TEXT NOT NULL REFERENCES source(id),
      source_label TEXT NOT NULL,
      market_id TEXT NOT NULL REFERENCES market(id),
      mapping_version TEXT NOT NULL,
      reviewed_by TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      PRIMARY KEY (source_id, source_label)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS price_observation (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      staging_id TEXT NOT NULL REFERENCES staging_observation(id),
      source_publication_id TEXT NOT NULL REFERENCES source_publication(id),
      source_artifact_id TEXT NOT NULL REFERENCES source_artifact(id),
      item_id TEXT NOT NULL REFERENCES item(id),
      market_id TEXT NOT NULL REFERENCES market(id),
      price_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      value_kind TEXT NOT NULL CHECK (value_kind IN ('range', 'point')),
      min_value_minor INTEGER NOT NULL CHECK (min_value_minor > 0),
      max_value_minor INTEGER NOT NULL CHECK (max_value_minor > 0),
      normalized_min_value_minor INTEGER NOT NULL CHECK (normalized_min_value_minor > 0),
      normalized_max_value_minor INTEGER NOT NULL CHECK (normalized_max_value_minor > 0),
      source_quantity TEXT NOT NULL,
      source_unit TEXT NOT NULL,
      normalized_quantity TEXT NOT NULL,
      normalized_unit TEXT NOT NULL,
      conversion_rule_id TEXT NOT NULL REFERENCES unit_conversion_rule(id),
      observed_from TEXT NOT NULL,
      observed_to TEXT NOT NULL,
      source_row_ref TEXT NOT NULL,
      confidence TEXT NOT NULL,
      comparability_key TEXT NOT NULL,
      lineage_key TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      mapping_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'withdrawn')),
      supersedes_id TEXT REFERENCES price_observation(id),
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE UNIQUE INDEX IF NOT EXISTS price_observation_active_lineage_idx
      ON price_observation(lineage_key) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS price_observation_series_idx
      ON price_observation(comparability_key, observed_from, status);

    CREATE TABLE IF NOT EXISTS release_observation (
      data_version TEXT NOT NULL REFERENCES data_release(data_version),
      observation_id TEXT NOT NULL REFERENCES price_observation(id),
      PRIMARY KEY (data_version, observation_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS release_artifact (
      data_version TEXT NOT NULL REFERENCES data_release(data_version),
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size > 0),
      sha256 TEXT NOT NULL,
      PRIMARY KEY (data_version, filename)
    ) STRICT;
  `);

  addColumn(database, "data_release", "build_commit", "TEXT");
}

function addColumn(database: OperationalDatabase, table: string, column: string, definition: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((candidate) => candidate.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function syncSource(database: OperationalDatabase, manifest: SourceManifest): void {
  const now = new Date().toISOString();
  const expired = new Date(`${manifest.review_due_at}T23:59:59.999Z`) < new Date();
  const state = !manifest.enabled || manifest.rights_status === "blocked" ? "blocked" : expired ? "review_required" : "paused";

  database
    .prepare(
      `INSERT INTO source (
        id, manifest_json, name, owner, landing_url, rights_status,
        rights_evidence_ref, reviewed_at, review_due_at, enabled, state, updated_at
      ) VALUES (
        @id, @manifest_json, @name, @owner, @landing_url, @rights_status,
        @rights_evidence_ref, @reviewed_at, @review_due_at, @enabled, @state, @updated_at
      ) ON CONFLICT(id) DO UPDATE SET
        manifest_json = excluded.manifest_json,
        name = excluded.name,
        owner = excluded.owner,
        landing_url = excluded.landing_url,
        rights_status = excluded.rights_status,
        rights_evidence_ref = excluded.rights_evidence_ref,
        reviewed_at = excluded.reviewed_at,
        review_due_at = excluded.review_due_at,
        enabled = excluded.enabled,
        state = CASE
          WHEN source.state IN ('healthy', 'late', 'degraded') AND excluded.enabled = 1 THEN source.state
          ELSE excluded.state
        END,
        updated_at = excluded.updated_at`,
    )
    .run({
      ...manifest,
      manifest_json: JSON.stringify(manifest),
      enabled: manifest.enabled ? 1 : 0,
      state,
      updated_at: now,
    });
}

export function startRun(
  database: OperationalDatabase,
  options: { sourceId: string; trigger: string; from?: string | undefined; to?: string | undefined; leaseMinutes?: number },
): { id: string; started: boolean } {
  const transaction = database.transaction(() => {
    const now = new Date();
    const nowIso = now.toISOString();
    database
      .prepare(
        `UPDATE ingest_run
         SET status = 'failed', finished_at = @now, error_code = 'LEASE_EXPIRED',
             error_message = 'Previous run lease expired'
         WHERE source_id = @source_id AND status = 'running' AND lease_expires_at < @now`,
      )
      .run({ source_id: options.sourceId, now: nowIso });

    const active = database
      .prepare("SELECT id FROM ingest_run WHERE source_id = ? AND status = 'running' LIMIT 1")
      .get(options.sourceId) as { id: string } | undefined;
    if (active) return { id: active.id, started: false };

    const id = newId("run");
    const leaseExpires = new Date(now.getTime() + (options.leaseMinutes ?? 30) * 60_000).toISOString();
    database
      .prepare(
        `INSERT INTO ingest_run (
          id, source_id, trigger, status, requested_from, requested_to,
          started_at, heartbeat_at, lease_expires_at
        ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(id, options.sourceId, options.trigger, options.from ?? null, options.to ?? null, nowIso, nowIso, leaseExpires);
    return { id, started: true };
  });

  return transaction();
}

export function heartbeatRun(database: OperationalDatabase, runId: string, leaseMinutes = 30): void {
  const now = new Date();
  database
    .prepare("UPDATE ingest_run SET heartbeat_at = ?, lease_expires_at = ? WHERE id = ? AND status = 'running'")
    .run(now.toISOString(), new Date(now.getTime() + leaseMinutes * 60_000).toISOString(), runId);
}

export function startStage(database: OperationalDatabase, runId: string, stage: StageName, inputCount = 0): void {
  database
    .prepare(
      `INSERT INTO run_stage (run_id, stage, status, started_at, input_count)
       VALUES (?, ?, 'running', ?, ?)
       ON CONFLICT(run_id, stage) DO UPDATE SET
         status = 'running', started_at = excluded.started_at, finished_at = NULL,
         input_count = excluded.input_count, output_count = 0, warning_count = 0,
         error_code = NULL, error_message = NULL`,
    )
    .run(runId, stage, new Date().toISOString(), inputCount);
}

export function finishStage(
  database: OperationalDatabase,
  runId: string,
  stage: StageName,
  status: Exclude<RunStatus, "running">,
  options: { outputCount?: number; warningCount?: number; errorCode?: string; errorMessage?: string } = {},
): void {
  database
    .prepare(
      `UPDATE run_stage SET status = @status, finished_at = @finished_at,
        output_count = @output_count, warning_count = @warning_count,
        error_code = @error_code, error_message = @error_message
       WHERE run_id = @run_id AND stage = @stage`,
    )
    .run({
      run_id: runId,
      stage,
      status,
      finished_at: new Date().toISOString(),
      output_count: options.outputCount ?? 0,
      warning_count: options.warningCount ?? 0,
      error_code: options.errorCode ?? null,
      error_message: options.errorMessage ?? null,
    });
}

export function finishRun(
  database: OperationalDatabase,
  runId: string,
  status: Exclude<RunStatus, "running">,
  error?: { code: string; message: string },
): void {
  database
    .prepare(
      `UPDATE ingest_run SET status = ?, finished_at = ?, heartbeat_at = ?,
       error_code = ?, error_message = ? WHERE id = ?`,
    )
    .run(status, new Date().toISOString(), new Date().toISOString(), error?.code ?? null, error?.message ?? null, runId);
}
