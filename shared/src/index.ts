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

const stableId = z.string().regex(/^[a-z0-9][a-z0-9._:-]*$/u);

export const mappingBundleSchema = z
  .object({
    schema_version: z.literal("1.0.0"),
    mapping_version: z.string().min(1),
    source_id: stableId,
    reviewed_by: z.string().min(1),
    reviewed_at: isoDate,
    evidence_ref: z.string().min(1),
    items: z.array(
      z.object({
        id: stableId,
        entity_type: z.enum(["commodity", "variety", "packaged_product"]),
        canonical_label_en: z.string().min(1),
        canonical_label_si: z.string().min(1).nullable(),
        canonical_label_ta: z.string().min(1).nullable(),
        variety: z.string().min(1).nullable(),
        grade: z.string().min(1).nullable(),
        source_labels: z.array(z.string().min(1)).min(1),
      }),
    ),
    markets: z.array(
      z.object({
        id: stableId,
        type: z.enum(["wholesale_market", "retail_market", "administrative_scope"]),
        label_en: z.string().min(1),
        label_si: z.string().min(1).nullable(),
        label_ta: z.string().min(1).nullable(),
        pcode: z.string().min(1).nullable(),
        scope_note: z.string().min(1),
        source_labels: z.array(z.string().min(1)).min(1),
      }),
    ),
    units: z.array(
      z.object({
        id: stableId,
        source_unit: z.string().min(1),
        normalized_unit: z.string().min(1),
        factor_numerator: z.number().int().positive(),
        factor_denominator: z.number().int().positive(),
        rounding_mode: z.literal("half_away_from_zero"),
      }),
    ),
  })
  .superRefine((bundle, context) => {
    checkUnique(bundle.items.map((item) => item.id), context, ["items"], "item IDs");
    checkUnique(bundle.items.flatMap((item) => item.source_labels), context, ["items"], "item source labels");
    checkUnique(bundle.markets.map((market) => market.id), context, ["markets"], "market IDs");
    checkUnique(bundle.markets.flatMap((market) => market.source_labels), context, ["markets"], "market source labels");
    checkUnique(bundle.units.map((unit) => unit.id), context, ["units"], "unit rule IDs");
    checkUnique(bundle.units.map((unit) => unit.source_unit), context, ["units"], "unit source labels");
  });

function checkUnique(values: string[], context: z.RefinementCtx, path: PropertyKey[], label: string): void {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `Duplicate ${label}`, path });
}

export type MappingBundle = z.infer<typeof mappingBundleSchema>;

export function canPublishSource(manifest: SourceManifest, today = new Date()): boolean {
  const reviewDue = new Date(`${manifest.review_due_at}T23:59:59.999Z`);
  return manifest.enabled && publicRightsStatuses.has(manifest.rights_status) && reviewDue >= today;
}
