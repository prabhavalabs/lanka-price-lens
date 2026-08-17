import { z } from "zod";

export const rightsStatuses = [
  "approved_open",
  "approved_permission",
  "link_only",
  "internal_evaluation",
  "blocked",
  "unknown",
] as const;

export const publicRightsStatuses = new Set<(typeof rightsStatuses)[number]>([
  "approved_open",
  "approved_permission",
]);

export const sourceStates = [
  "healthy",
  "late",
  "degraded",
  "paused",
  "review_required",
  "blocked",
] as const;

export const runStatuses = [
  "running",
  "succeeded",
  "failed",
  "blocked",
  "skipped",
] as const;

export const stageNames = [
  "rights",
  "discover",
  "fetch",
  "extract",
  "parse",
  "map",
  "validate",
  "release",
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const sourceManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_]*$/),
    name: z.string().min(1),
    owner: z.string().min(1),
    landing_url: z.url(),
    retrieval_method: z.enum(["scheduled_download", "manual", "partner_feed"]),
    expected_cadence: z.enum(["business_daily", "daily", "weekly", "event_driven"]),
    formats: z.array(z.enum(["pdf", "csv", "json", "xlsx", "html"])).min(1),
    geographic_scope: z.string().min(1),
    price_types: z.array(z.string().min(1)).min(1),
    rights_status: z.enum(rightsStatuses),
    rights_evidence_ref: z.string().min(1).nullable(),
    attribution_text: z.string().min(1).nullable(),
    retention_policy: z.enum([
      "preserve_source_evidence",
      "metadata_and_checksum_only",
      "do_not_retain",
    ]),
    parser_owner: z.string().min(1).nullable(),
    reviewed_by: z.string().min(1).nullable(),
    reviewed_at: isoDate,
    review_due_at: isoDate,
    request_interval_ms: z.number().int().min(1_000),
    max_attempts: z.number().int().min(1).max(10),
    enabled: z.boolean(),
  })
  .superRefine((manifest, context) => {
    if (
      publicRightsStatuses.has(manifest.rights_status) &&
      (!manifest.rights_evidence_ref || !manifest.attribution_text || !manifest.reviewed_by)
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved sources require rights evidence, attribution, and a reviewer",
        path: ["rights_status"],
      });
    }
  });

export type SourceManifest = z.infer<typeof sourceManifestSchema>;
export type RightsStatus = (typeof rightsStatuses)[number];
export type SourceState = (typeof sourceStates)[number];
export type RunStatus = (typeof runStatuses)[number];
export type StageName = (typeof stageNames)[number];

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  payload: T;
  meta: {
    request_id: string;
    generated_at: string;
  };
};

export function canPublishSource(manifest: SourceManifest, today = new Date()): boolean {
  const reviewDue = new Date(`${manifest.review_due_at}T23:59:59.999Z`);
  return manifest.enabled && publicRightsStatuses.has(manifest.rights_status) && reviewDue >= today;
}
