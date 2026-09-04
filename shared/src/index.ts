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
  "check_source",
  "compare_inventory",
  "download_new_pdfs",
  "upload_to_r2",
  "record_pdf_metadata",
  "retrieve_pdf",
  "parse_pdf",
  "extract_data",
  "validate_data",
  "insert_data",
  "assess_completeness",
  "canonicalize_data",
  "crawl",
  "download",
  "process",
  "store",
  "rights",
  "discover",
  "fetch",
  "extract",
  "parse",
  "map",
  "canonicalize",
  "validate",
  "release",
  "fetch_snapshot",
  "normalize_records",
  "validate_records",
  "store_snapshot",
] as const;

export const workflowNames = ["source_sync", "pdf_processing", "legacy_ingestion", "retail_capture"] as const;

/** Retail price adapters the foundry can run against an online store or a price publication. */
export const retailAdapterKinds = ["spar_shopify", "glomark_html", "keells_api", "cargills_api"] as const;
export type RetailAdapterKind = (typeof retailAdapterKinds)[number];

export const priceTypes = ["wholesale_observed", "retail_observed", "retail_online_store", "producer_observed"] as const;

/** Parsers for PDF publications the document pipeline can process. */
export const documentAdapterKinds = ["harti_daily", "cbsl_daily_price", "dcs_weekly_retail"] as const;
export type DocumentAdapterKind = (typeof documentAdapterKinds)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const sourceManifestSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_]*$/),
    name: z.string().min(1),
    owner: z.string().min(1),
    landing_url: z.url(),
    retrieval_method: z.enum(["scheduled_download", "manual", "partner_feed", "api_snapshot"]),
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
    /** Which document parser reads this source's PDFs; ignored for retail adapter sources. */
    document_adapter: z.enum(documentAdapterKinds).default("harti_daily"),
    /** Present for sources captured through a retail adapter; absent for PDF bulletin sources. */
    adapter: z
      .object({
        kind: z.enum(retailAdapterKinds),
        settings: z.record(z.string(), z.unknown()).default({}),
      })
      .nullable()
      .default(null),
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
export type WorkflowName = (typeof workflowNames)[number];

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
    products: z.array(
      z.object({
        id: stableId,
        category: z.enum(["vegetable", "fruit", "grain", "fish", "meat", "dairy", "other"]),
        canonical_label_en: z.string().min(1),
        canonical_label_si: z.string().min(1).nullable(),
        canonical_label_ta: z.string().min(1).nullable(),
      }),
    ).default([]),
    items: z.array(
      z.object({
        id: stableId,
        product_id: stableId.nullable().default(null),
        entity_type: z.enum(["commodity", "variety", "packaged_product"]),
        canonical_label_en: z.string().min(1),
        canonical_label_si: z.string().min(1).nullable(),
        canonical_label_ta: z.string().min(1).nullable(),
        variety: z.string().min(1).nullable(),
        origin: z.string().min(1).nullable().default(null),
        size: z.string().min(1).nullable().default(null),
        grade: z.string().min(1).nullable(),
        source_labels: z.array(z.string().min(1)).min(1),
        expected_market_labels: z.array(z.string().min(1)).default([]),
      }),
    ),
    markets: z.array(
      z.object({
        id: stableId,
        type: z.enum(["wholesale_market", "retail_market", "online_store", "administrative_scope"]),
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
    completeness: z.object({
      minimum_item_coverage: z.number().min(0).max(1),
      minimum_market_coverage: z.number().min(0).max(1),
      minimum_cell_coverage: z.number().min(0).max(1),
      minimum_mapping_coverage: z.number().min(0).max(1),
      minimum_score: z.number().min(0).max(1),
    }).default({
      minimum_item_coverage: 0.7,
      minimum_market_coverage: 0.7,
      minimum_cell_coverage: 0.6,
      minimum_mapping_coverage: 0.98,
      minimum_score: 0.7,
    }),
  })
  .superRefine((bundle, context) => {
    checkUnique(bundle.products.map((product) => product.id), context, ["products"], "product IDs");
    checkUnique(bundle.items.map((item) => item.id), context, ["items"], "item IDs");
    checkUnique(bundle.items.flatMap((item) => item.source_labels), context, ["items"], "item source labels");
    checkUnique(bundle.markets.map((market) => market.id), context, ["markets"], "market IDs");
    checkUnique(bundle.markets.flatMap((market) => market.source_labels), context, ["markets"], "market source labels");
    checkUnique(bundle.units.map((unit) => unit.id), context, ["units"], "unit rule IDs");
    checkUnique(bundle.units.map((unit) => unit.source_unit), context, ["units"], "unit source labels");
    const productIds = new Set(bundle.products.map((product) => product.id));
    const marketLabels = new Set(bundle.markets.flatMap((market) => market.source_labels));
    for (const [index, item] of bundle.items.entries()) {
      if (item.product_id && !productIds.has(item.product_id)) {
        context.addIssue({ code: "custom", message: `Unknown product ID ${item.product_id}`, path: ["items", index, "product_id"] });
      }
      for (const label of item.expected_market_labels) {
        if (!marketLabels.has(label)) {
          context.addIssue({ code: "custom", message: `Unknown expected market label ${label}`, path: ["items", index, "expected_market_labels"] });
        }
      }
    }
  });

function checkUnique(values: string[], context: z.RefinementCtx, path: PropertyKey[], label: string): void {
  if (new Set(values).size !== values.length) context.addIssue({ code: "custom", message: `Duplicate ${label}`, path });
}

export type MappingBundle = z.infer<typeof mappingBundleSchema>;

export type SourceKind = "pdf_bulletin" | "retail_snapshot";

/** How a source is collected: PDF bulletins go through the document pipeline, retail adapters take snapshots. */
export function sourceKind(manifest: Pick<SourceManifest, "adapter">): SourceKind {
  return manifest.adapter ? "retail_snapshot" : "pdf_bulletin";
}

/** Rights states under which prices may be captured into the operational store (not necessarily released publicly). */
export const captureRightsStatuses = new Set<(typeof rightsStatuses)[number]>(["approved_open", "approved_permission", "internal_evaluation"]);

/** Capture is allowed while the source is enabled, its rights review is current, and it is public or under internal evaluation. */
export function canCaptureSource(manifest: SourceManifest, today = new Date()): boolean {
  const reviewDue = new Date(`${manifest.review_due_at}T23:59:59.999Z`);
  return manifest.enabled && captureRightsStatuses.has(manifest.rights_status) && reviewDue >= today;
}

export function canPublishSource(manifest: SourceManifest, today = new Date()): boolean {
  const reviewDue = new Date(`${manifest.review_due_at}T23:59:59.999Z`);
  return manifest.enabled && publicRightsStatuses.has(manifest.rights_status) && reviewDue >= today;
}
