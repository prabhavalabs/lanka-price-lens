import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

import Database from "better-sqlite3";

import type { RunStatus, SourceManifest, StageName, WorkflowName } from "@lanka-pricelens/shared";

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

    CREATE TABLE IF NOT EXISTS admin_user (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS admin_session (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    ) STRICT;

    CREATE INDEX IF NOT EXISTS admin_session_user_expiry_idx
      ON admin_session(user_id, expires_at DESC);

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

    CREATE TABLE IF NOT EXISTS run_stage_log (
      id INTEGER PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      stage TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
      message TEXT NOT NULL,
      data_json TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS run_stage_log_run_stage_idx
      ON run_stage_log(run_id, stage, id);

    CREATE TABLE IF NOT EXISTS workflow_schedule (
      id TEXT PRIMARY KEY,
      workflow_key TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES source(id),
      cron_expression TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      max_items INTEGER CHECK (max_items IS NULL OR max_items > 0),
      next_run_at TEXT NOT NULL,
      last_due_at TEXT,
      last_dispatch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workflow_key, source_id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS workflow_schedule_due_idx
      ON workflow_schedule(enabled, next_run_at);

    CREATE TABLE IF NOT EXISTS workflow_dispatch (
      id TEXT PRIMARY KEY,
      schedule_id TEXT REFERENCES workflow_schedule(id),
      workflow_key TEXT NOT NULL,
      source_id TEXT NOT NULL REFERENCES source(id),
      archive_id TEXT REFERENCES archived_pdf(id),
      trigger TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
      scheduled_for TEXT NOT NULL,
      available_at TEXT NOT NULL,
      claimed_by TEXT,
      claimed_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      run_id TEXT REFERENCES ingest_run(id),
      requested_by TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS workflow_dispatch_queue_idx
      ON workflow_dispatch(status, available_at, scheduled_for);
    CREATE INDEX IF NOT EXISTS workflow_dispatch_archive_idx
      ON workflow_dispatch(archive_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS workflow_dispatch_workflow_status_idx
      ON workflow_dispatch(workflow_key, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS workflow_dispatch_workflow_created_idx
      ON workflow_dispatch(workflow_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS scheduler_instance (
      id TEXT PRIMARY KEY,
      environment TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      last_tick_at TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS run_publication (
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      publication_id TEXT NOT NULL REFERENCES source_publication(id),
      ordinal INTEGER NOT NULL,
      PRIMARY KEY (run_id, publication_id)
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

    CREATE TABLE IF NOT EXISTS archived_pdf (
      id TEXT PRIMARY KEY,
      publication_id TEXT NOT NULL REFERENCES source_publication(id) UNIQUE,
      source_sync_run_id TEXT REFERENCES ingest_run(id),
      source_url TEXT NOT NULL,
      r2_bucket TEXT NOT NULL,
      r2_key TEXT NOT NULL UNIQUE,
      r2_uri TEXT NOT NULL UNIQUE,
      byte_size INTEGER CHECK (byte_size IS NULL OR byte_size > 0),
      sha256 TEXT,
      etag TEXT,
      uploaded_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS product (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('vegetable', 'fruit', 'grain', 'fish', 'meat', 'dairy', 'other')),
      canonical_label_en TEXT NOT NULL,
      canonical_label_si TEXT,
      canonical_label_ta TEXT,
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

    CREATE TABLE IF NOT EXISTS source_item_market_expectation (
      source_id TEXT NOT NULL REFERENCES source(id),
      source_item_label TEXT NOT NULL,
      source_market_label TEXT NOT NULL,
      mapping_version TEXT NOT NULL,
      PRIMARY KEY (source_id, source_item_label, source_market_label)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS mapping_bundle_registry (
      source_id TEXT NOT NULL REFERENCES source(id),
      mapping_version TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL,
      reviewed_by TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      evidence_ref TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (source_id, mapping_version)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS artifact_quality_assessment (
      artifact_id TEXT PRIMARY KEY REFERENCES source_artifact(id),
      run_id TEXT NOT NULL REFERENCES ingest_run(id),
      mapping_version TEXT,
      status TEXT NOT NULL CHECK (status IN ('complete', 'review_required', 'incomplete', 'not_configured')),
      score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
      item_coverage REAL NOT NULL CHECK (item_coverage >= 0 AND item_coverage <= 1),
      market_coverage REAL NOT NULL CHECK (market_coverage >= 0 AND market_coverage <= 1),
      cell_coverage REAL NOT NULL CHECK (cell_coverage >= 0 AND cell_coverage <= 1),
      mapping_coverage REAL NOT NULL CHECK (mapping_coverage >= 0 AND mapping_coverage <= 1),
      expected_items INTEGER NOT NULL CHECK (expected_items >= 0),
      observed_items INTEGER NOT NULL CHECK (observed_items >= 0),
      expected_markets INTEGER NOT NULL CHECK (expected_markets >= 0),
      observed_markets INTEGER NOT NULL CHECK (observed_markets >= 0),
      expected_cells INTEGER NOT NULL CHECK (expected_cells >= 0),
      observed_cells INTEGER NOT NULL CHECK (observed_cells >= 0),
      total_rows INTEGER NOT NULL CHECK (total_rows >= 0),
      mapped_rows INTEGER NOT NULL CHECK (mapped_rows >= 0),
      unknown_item_rows INTEGER NOT NULL CHECK (unknown_item_rows >= 0),
      unknown_market_rows INTEGER NOT NULL CHECK (unknown_market_rows >= 0),
      unknown_unit_rows INTEGER NOT NULL CHECK (unknown_unit_rows >= 0),
      diagnostics_json TEXT NOT NULL,
      assessed_at TEXT NOT NULL
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
  addColumn(database, "source_artifact", "run_id", "TEXT REFERENCES ingest_run(id)");
  addColumn(database, "source_artifact", "original_filename", "TEXT");
  addColumn(database, "source_artifact", "inspection_json", "TEXT");
  addColumn(database, "source_artifact", "parser_strategy", "TEXT");
  addColumn(database, "source_artifact", "parser_confidence", "REAL");
  addColumn(database, "source_artifact", "parser_diagnostics_json", "TEXT");
  addColumn(database, "item", "product_id", "TEXT REFERENCES product(id)");
  addColumn(database, "item", "origin", "TEXT");
  addColumn(database, "item", "size", "TEXT");
  addColumn(database, "price_observation", "effective_key", "TEXT");
  addColumn(database, "price_observation", "source_published_at", "TEXT");
  addColumn(database, "price_observation", "source_fetched_at", "TEXT");
  addColumn(database, "price_observation", "superseded_by_id", "TEXT REFERENCES price_observation(id)");
  addColumn(database, "price_observation", "revision_reason", "TEXT");
  addColumn(database, "run_stage", "input_json", "TEXT");
  addColumn(database, "run_stage", "output_json", "TEXT");
  addColumn(database, "run_stage", "attempt_count", "INTEGER NOT NULL DEFAULT 0");
  addColumn(database, "ingest_run", "workflow", "TEXT NOT NULL DEFAULT 'legacy_ingestion'");
  addColumn(database, "ingest_run", "parent_run_id", "TEXT REFERENCES ingest_run(id)");
  addColumn(database, "ingest_run", "archive_id", "TEXT REFERENCES archived_pdf(id)");
  addColumn(database, "ingest_run", "artifact_id", "TEXT REFERENCES source_artifact(id)");
  addColumn(database, "ingest_run", "definition_key", "TEXT");
  addColumn(database, "ingest_run", "definition_version", "INTEGER");
  addColumn(database, "ingest_run", "dispatch_id", "TEXT REFERENCES workflow_dispatch(id)");
  addColumn(database, "ingest_run", "scheduled_for", "TEXT");
  addColumn(database, "ingest_run", "environment", "TEXT");
  database.exec(`
    CREATE TABLE IF NOT EXISTS workflow_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK (event_type IN ('dispatch', 'run', 'stage')),
      dispatch_id TEXT,
      run_id TEXT,
      archive_id TEXT,
      publication_id TEXT,
      stage TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS workflow_event_created_idx
      ON workflow_event(id);
    CREATE INDEX IF NOT EXISTS workflow_event_publication_idx
      ON workflow_event(publication_id, id DESC);
    CREATE INDEX IF NOT EXISTS workflow_event_run_idx
      ON workflow_event(run_id, id DESC);

    CREATE TRIGGER IF NOT EXISTS workflow_dispatch_event_insert
    AFTER INSERT ON workflow_dispatch
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, status, created_at
      ) VALUES (
        'dispatch', NEW.id, NEW.run_id, NEW.archive_id,
        (SELECT publication_id FROM archived_pdf WHERE id = NEW.archive_id),
        NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS workflow_dispatch_event_update
    AFTER UPDATE ON workflow_dispatch
    WHEN OLD.status IS NOT NEW.status OR OLD.run_id IS NOT NEW.run_id
      OR OLD.error_code IS NOT NEW.error_code OR OLD.error_message IS NOT NEW.error_message
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, status, created_at
      ) VALUES (
        'dispatch', NEW.id, NEW.run_id, NEW.archive_id,
        (SELECT publication_id FROM archived_pdf WHERE id = NEW.archive_id),
        NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS ingest_run_event_insert
    AFTER INSERT ON ingest_run
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, status, created_at
      ) VALUES (
        'run', NEW.dispatch_id, NEW.id, NEW.archive_id,
        (SELECT publication_id FROM archived_pdf WHERE id = NEW.archive_id),
        NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS ingest_run_event_update
    AFTER UPDATE ON ingest_run
    WHEN OLD.status IS NOT NEW.status OR OLD.error_code IS NOT NEW.error_code
      OR OLD.error_message IS NOT NEW.error_message
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, status, created_at
      ) VALUES (
        'run', NEW.dispatch_id, NEW.id, NEW.archive_id,
        (SELECT publication_id FROM archived_pdf WHERE id = NEW.archive_id),
        NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS run_stage_event_insert
    AFTER INSERT ON run_stage
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, stage, status, created_at
      ) VALUES (
        'stage',
        (SELECT dispatch_id FROM ingest_run WHERE id = NEW.run_id),
        NEW.run_id,
        (SELECT archive_id FROM ingest_run WHERE id = NEW.run_id),
        (SELECT archive.publication_id FROM ingest_run run
          JOIN archived_pdf archive ON archive.id = run.archive_id WHERE run.id = NEW.run_id),
        NEW.stage, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS run_stage_event_update
    AFTER UPDATE ON run_stage
    WHEN OLD.status IS NOT NEW.status OR OLD.attempt_count IS NOT NEW.attempt_count
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, stage, status, created_at
      ) VALUES (
        'stage',
        (SELECT dispatch_id FROM ingest_run WHERE id = NEW.run_id),
        NEW.run_id,
        (SELECT archive_id FROM ingest_run WHERE id = NEW.run_id),
        (SELECT archive.publication_id FROM ingest_run run
          JOIN archived_pdf archive ON archive.id = run.archive_id WHERE run.id = NEW.run_id),
        NEW.stage, NEW.status, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      );
    END;

    CREATE TRIGGER IF NOT EXISTS run_stage_log_event_insert
    AFTER INSERT ON run_stage_log
    BEGIN
      INSERT INTO workflow_event (
        event_type, dispatch_id, run_id, archive_id, publication_id, stage, status, created_at
      ) VALUES (
        'stage',
        (SELECT dispatch_id FROM ingest_run WHERE id = NEW.run_id),
        NEW.run_id,
        (SELECT archive_id FROM ingest_run WHERE id = NEW.run_id),
        (SELECT archive.publication_id FROM ingest_run run
          JOIN archived_pdf archive ON archive.id = run.archive_id WHERE run.id = NEW.run_id),
        NEW.stage,
        COALESCE((SELECT status FROM run_stage WHERE run_id = NEW.run_id AND stage = NEW.stage), 'running'),
        NEW.created_at
      );
    END;

    CREATE TRIGGER IF NOT EXISTS workflow_event_retention
    AFTER INSERT ON workflow_event
    WHEN NEW.id % 1000 = 0
    BEGIN
      DELETE FROM workflow_event WHERE id < NEW.id - 50000;
    END;

    CREATE INDEX IF NOT EXISTS ingest_run_archive_workflow_started_v2_idx
      ON ingest_run(archive_id, workflow, started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS ingest_run_dispatch_idx
      ON ingest_run(dispatch_id);
    CREATE INDEX IF NOT EXISTS source_publication_timeline_idx
      ON source_publication(published_at DESC, first_seen_at DESC);
    CREATE INDEX IF NOT EXISTS source_artifact_publication_fetched_idx
      ON source_artifact(publication_id, fetched_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS quarantine_artifact_status_idx
      ON quarantine(artifact_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS price_observation_active_effective_idx
      ON price_observation(effective_key) WHERE status = 'active' AND effective_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS price_observation_processing_version_idx
      ON price_observation(staging_id, mapping_version, parser_version);
    CREATE INDEX IF NOT EXISTS price_observation_source_artifact_idx
      ON price_observation(source_artifact_id);
    CREATE INDEX IF NOT EXISTS price_observation_effective_history_idx
      ON price_observation(effective_key, source_published_at DESC, created_at DESC);
    CREATE INDEX IF NOT EXISTS artifact_quality_status_score_idx
      ON artifact_quality_assessment(status, score);

    CREATE TABLE IF NOT EXISTS source_adapter_setting (
      source_id TEXT PRIMARY KEY REFERENCES source(id),
      settings_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  // Capture health for adapter-driven sources (circuit breaker state).
  addColumn(database, "source", "consecutive_failures", "INTEGER NOT NULL DEFAULT 0");
  addColumn(database, "source", "paused_until", "TEXT");
  addColumn(database, "source", "last_capture_error", "TEXT");
  addColumn(database, "source", "last_capture_at", "TEXT");
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
  options: {
    sourceId: string;
    trigger: string;
    workflow?: WorkflowName;
    parentRunId?: string | undefined;
    archiveId?: string | undefined;
    artifactId?: string | undefined;
    definitionKey?: string | undefined;
    definitionVersion?: number | undefined;
    dispatchId?: string | undefined;
    scheduledFor?: string | undefined;
    environment?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    leaseMinutes?: number;
  },
): { id: string; started: boolean } {
  const transaction = database.transaction(() => {
    const now = new Date();
    const nowIso = now.toISOString();
    const workflow = options.workflow ?? "legacy_ingestion";
    database
      .prepare(
        `UPDATE ingest_run
         SET status = 'failed', finished_at = @now, error_code = 'LEASE_EXPIRED',
             error_message = 'Previous run lease expired'
         WHERE source_id = @source_id AND status = 'running' AND lease_expires_at < @now`,
      )
      .run({ source_id: options.sourceId, now: nowIso });

    const active = database
      .prepare(
        workflow === "pdf_processing"
          ? "SELECT id FROM ingest_run WHERE source_id = ? AND workflow = ? AND archive_id = ? AND status = 'running' LIMIT 1"
          : "SELECT id FROM ingest_run WHERE source_id = ? AND workflow != 'pdf_processing' AND status = 'running' LIMIT 1",
      )
      .get(...(workflow === "pdf_processing" ? [options.sourceId, workflow, options.archiveId ?? null] : [options.sourceId])) as { id: string } | undefined;
    if (active) return { id: active.id, started: false };

    const id = newId("run");
    const leaseExpires = new Date(now.getTime() + (options.leaseMinutes ?? 30) * 60_000).toISOString();
    database
      .prepare(
        `INSERT INTO ingest_run (
          id, source_id, trigger, workflow, parent_run_id, archive_id, artifact_id,
          definition_key, definition_version, dispatch_id, scheduled_for, environment,
          status, requested_from, requested_to, started_at, heartbeat_at, lease_expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        options.sourceId,
        options.trigger,
        workflow,
        options.parentRunId ?? null,
        options.archiveId ?? null,
        options.artifactId ?? null,
        options.definitionKey ?? null,
        options.definitionVersion ?? null,
        options.dispatchId ?? null,
        options.scheduledFor ?? null,
        options.environment ?? null,
        options.from ?? null,
        options.to ?? null,
        nowIso,
        nowIso,
        leaseExpires,
      );
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

export function startStage(
  database: OperationalDatabase,
  runId: string,
  stage: StageName,
  inputCount = 0,
  input?: unknown,
): void {
  database
    .prepare(
      `INSERT INTO run_stage (run_id, stage, status, started_at, input_count, input_json, attempt_count)
       VALUES (?, ?, 'running', ?, ?, ?, 1)
       ON CONFLICT(run_id, stage) DO UPDATE SET
         status = 'running', started_at = excluded.started_at, finished_at = NULL,
         input_count = excluded.input_count, output_count = 0, warning_count = 0,
         error_code = NULL, error_message = NULL, input_json = excluded.input_json,
         output_json = NULL, attempt_count = run_stage.attempt_count + 1`,
    )
    .run(runId, stage, new Date().toISOString(), inputCount, input === undefined ? null : JSON.stringify(input));
}

export function finishStage(
  database: OperationalDatabase,
  runId: string,
  stage: StageName,
  status: Exclude<RunStatus, "running">,
  options: { outputCount?: number; warningCount?: number; errorCode?: string; errorMessage?: string; output?: unknown } = {},
): void {
  database
    .prepare(
      `UPDATE run_stage SET status = @status, finished_at = @finished_at,
        output_count = @output_count, warning_count = @warning_count,
        error_code = @error_code, error_message = @error_message, output_json = @output_json
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
      output_json: options.output === undefined ? null : JSON.stringify(options.output),
    });
}

export function blockStage(
  database: OperationalDatabase,
  runId: string,
  stage: StageName,
  message: string,
  missingDependencies: string[],
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO run_stage (
        run_id, stage, status, started_at, finished_at, error_code, error_message, input_json, attempt_count
       ) VALUES (?, ?, 'blocked', ?, ?, 'DEPENDENCY_BLOCKED', ?, ?, 0)
       ON CONFLICT(run_id, stage) DO UPDATE SET
         status = 'blocked', started_at = excluded.started_at, finished_at = excluded.finished_at,
         error_code = excluded.error_code, error_message = excluded.error_message,
         input_json = excluded.input_json, output_json = NULL`,
    )
    .run(runId, stage, now, now, message, JSON.stringify({ missing_dependencies: missingDependencies }));
}

export function logStage(
  database: OperationalDatabase,
  runId: string,
  stage: StageName,
  level: "info" | "warning" | "error",
  message: string,
  data?: unknown,
): void {
  database
    .prepare(
      `INSERT INTO run_stage_log (run_id, stage, level, message, data_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(runId, stage, level, message, data === undefined ? null : JSON.stringify(data), new Date().toISOString());
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
