import { z } from "zod";

import type { SourceManifest } from "@lanka-pricelens/shared";

import { newId, syncSource, type OperationalDatabase } from "../db.ts";
import type { RetailAdapter } from "./types.ts";

/** Settings every adapter shares. Adapters extend this schema with their own fields. */
export const baseSettingsSchema = z.object({
  requestTimeoutMs: z.number().int().min(1_000).max(120_000).default(30_000).describe("Per-request timeout in milliseconds"),
  maxAttempts: z.number().int().min(1).max(8).default(3).describe("Attempts per request before the capture fails"),
  minimumRecords: z.number().int().min(1).default(20).describe("Fewest records a snapshot may contain before it is treated as broken"),
  maxConsecutiveFailures: z.number().int().min(1).max(20).default(3).describe("Failures in a row before the source is paused automatically"),
  maxRecordCountChangePct: z.number().min(5).max(100).default(50).describe("Largest swing in record count against the previous snapshot before the run is held for review"),
});
export type BaseSettings = z.infer<typeof baseSettingsSchema>;

export class SettingsError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`SETTINGS_INVALID: ${issues.join("; ")}`);
    this.name = "SettingsError";
    this.issues = issues;
  }
}

export function readAdapterOverrides(database: OperationalDatabase, sourceId: string): Record<string, unknown> {
  const row = database.prepare("SELECT settings_json FROM source_adapter_setting WHERE source_id = ?").get(sourceId) as { settings_json: string } | undefined;
  if (!row) return {};
  try {
    const parsed = JSON.parse(row.settings_json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Manifest defaults, overlaid with the admin-portal overrides, validated by the adapter's schema. */
export function resolveAdapterSettings<S>(database: OperationalDatabase, manifest: SourceManifest, adapter: RetailAdapter<S>): S {
  const merged = { ...(manifest.adapter?.settings ?? {}), ...readAdapterOverrides(database, manifest.id) };
  return parseSettings(adapter, merged);
}

export function parseSettings<S>(adapter: RetailAdapter<S>, candidate: unknown): S {
  const result = adapter.settingsSchema.safeParse(candidate);
  if (!result.success) throw new SettingsError(result.error.issues.map((issue) => `${issue.path.join(".") || "settings"}: ${issue.message}`));
  return result.data;
}

/** Persist admin overrides after validating the merged result, so a bad override can never break the next run. */
export function saveAdapterSettings<S>(
  database: OperationalDatabase,
  manifest: SourceManifest,
  adapter: RetailAdapter<S>,
  overrides: Record<string, unknown>,
  actor: string,
): S {
  const effective = parseSettings(adapter, { ...(manifest.adapter?.settings ?? {}), ...overrides });
  const now = new Date().toISOString();
  syncSource(database, manifest);
  database.transaction(() => {
    database
      .prepare(
        `INSERT INTO source_adapter_setting (source_id, settings_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(source_id) DO UPDATE SET settings_json = excluded.settings_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      )
      .run(manifest.id, JSON.stringify(overrides), actor, now);
    database
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'adapter.settings.updated', 'source', ?, ?, ?)`,
      )
      .run(newId("audit"), actor, manifest.id, JSON.stringify({ overrides }), now);
  })();
  return effective;
}

export function clearAdapterSettings(database: OperationalDatabase, sourceId: string, actor: string): void {
  const now = new Date().toISOString();
  database.transaction(() => {
    database.prepare("DELETE FROM source_adapter_setting WHERE source_id = ?").run(sourceId);
    database
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, 'adapter.settings.reset', 'source', ?, '{}', ?)`,
      )
      .run(newId("audit"), actor, sourceId, now);
  })();
}

/** JSON Schema for the admin portal's settings form. */
export function settingsJsonSchema<S>(adapter: RetailAdapter<S>): Record<string, unknown> {
  return z.toJSONSchema(adapter.settingsSchema as unknown as z.ZodType, { io: "input" }) as Record<string, unknown>;
}
