export type Envelope<T> = { success: boolean; message: string; payload: T };
export type AdminUser = { id: string; email: string };
export type LoginFailure =
  | { reason: "invalid_credentials"; attempts_remaining: number }
  | { reason: "account_locked"; attempts_remaining: 0; locked_until: string; retry_after_seconds: number };
export type Overview = { sources: number; pdfs: number; running: number; failed: number; quarantined: number };
export type Source = {
  id: string;
  name: string;
  owner: string;
  landing_url: string;
  rights_status: string;
  rights_evidence_ref: string | null;
  reviewed_at: string;
  review_due_at: string;
  enabled: number;
  state: string;
  last_discovery_at: string | null;
  last_fetch_at: string | null;
  last_parse_at: string | null;
  last_release_at: string | null;
  expected_cadence: string | null;
  retrieval_method: string | null;
  attribution_text: string | null;
  geographic_scope: string | null;
  retention_policy: string | null;
  publication_count: number;
  canonicalized_count: number;
  failed_runs_30d: number;
  observation_count: number;
  last_failure_at: string | null;
  last_error_message: string | null;
  adapter_kind: string | null;
  consecutive_failures: number;
  paused_until: string | null;
  last_capture_error: string | null;
  last_capture_at: string | null;
};
export type AdapterSchemaProperty = { type?: string | string[]; description?: string; default?: unknown; items?: { type?: string }; minimum?: number; maximum?: number };
export type AdapterSchema = { properties?: Record<string, AdapterSchemaProperty>; required?: string[] };
export type AdapterHealth = { state: string; consecutive_failures: number; paused_until: string | null; last_capture_error: string | null; last_capture_at: string | null };
export type AdapterLastRun = { id: string; status: string; trigger: string; started_at: string; finished_at: string | null; parsed_count: number; quarantined_count: number; error_code: string | null; error_message: string | null };
export type AdapterConfig = {
  adapter: { kind: string; label: string; description: string; market_label: string; price_type: string } | null;
  schema?: AdapterSchema;
  defaults?: Record<string, unknown>;
  overrides?: Record<string, unknown>;
  overrides_updated?: { updated_by: string; updated_at: string } | null;
  effective?: Record<string, unknown> | null;
  error?: string | null;
  health?: AdapterHealth | null;
  last_run?: AdapterLastRun | null;
  mapping_configured?: boolean;
};
export type UnmappedLabel = { label_type: "item" | "market" | "unit"; label: string; occurrences: number; first_seen_at: string; last_seen_at: string; last_market_label: string | null; last_quantity: string | null; last_unit: string | null; last_price_minor: number | null };
export type WorkflowName = "source_sync" | "pdf_processing" | "legacy_ingestion" | "retail_capture";
export type WorkflowStageName = "check_source" | "compare_inventory" | "download_new_pdfs" | "upload_to_r2" | "record_pdf_metadata" | "retrieve_pdf" | "parse_pdf" | "extract_data" | "validate_data" | "insert_data" | "assess_completeness" | "canonicalize_data" | "fetch_snapshot" | "normalize_records" | "validate_records" | "store_snapshot" | "crawl" | "download" | "process" | "validate" | "store" | "rights" | "discover" | "fetch" | "extract" | "parse" | "map" | "canonicalize" | "release";
export type Run = { id: string; source_id: string; workflow: WorkflowName; parent_run_id: string | null; archive_id: string | null; artifact_id: string | null; definition_key?: WorkflowKey | null; definition_version?: number | null; dispatch_id?: string | null; scheduled_for?: string | null; environment?: string | null; trigger: string; status: string; started_at: string; finished_at: string | null; discovered_count: number; fetched_count: number; extracted_count?: number; parsed_count: number; quarantined_count: number; error_code: string | null; error_message: string | null };
export type WorkflowLog = { id: number; level: "info" | "warning" | "error"; message: string; data: unknown; created_at: string };
export type WorkflowStep = { stage: WorkflowStageName; status: string; started_at: string | null; finished_at: string | null; duration_ms: number | null; input_count: number; output_count: number; warning_count: number; attempt_count: number; error_code: string | null; error_message: string | null; input: unknown; output: unknown; can_retry: boolean; retry_reason: string | null; missing_dependencies: string[]; logs: WorkflowLog[]; log_count: number };
export type RunWorkflow = { run: Run; stages: WorkflowStep[]; children: Run[] };
export type KnowledgeIndexStatus = "indexed" | "indexing" | "failed" | "not_indexed";
export type KnowledgeItem = { publication_id: string; document_id: string; title: string; published_at: string | null; observed_from: string | null; observed_to: string | null; download_url: string; archive_id: string | null; r2_uri: string | null; r2_key: string | null; artifact_id: string | null; run_id: string | null; original_filename: string; fetched_at: string | null; byte_size: number | null; sha256: string | null; status: string; index_status: KnowledgeIndexStatus; pdf_type: string | null; page_count: number | null; confidence: number | null; ocr_page_count: number; parser_strategy: string | null; parser_confidence: number | null; parsed_count: number; canonical_count: number; quarantined_count: number; quality_status: string | null; completeness_score: number | null; item_coverage: number | null; market_coverage: number | null; cell_coverage: number | null; mapping_coverage: number | null; processing_dispatch_id: string | null; processing_run_id: string | null; processing_status: string | null; processing_started_at: string | null; processing_finished_at: string | null; processing_error_code: string | null; processing_error_message: string | null };
export type KnowledgeListItem = Pick<KnowledgeItem, "publication_id" | "document_id" | "title" | "published_at" | "download_url" | "archive_id" | "byte_size" | "status" | "index_status" | "pdf_type" | "page_count" | "canonical_count" | "processing_dispatch_id" | "processing_run_id" | "processing_status">;
export type WorkflowKey = "latest_document_collection" | "historical_backfill" | "document_processing_pipeline" | "retail_price_capture";
export type WorkflowSchedule = { id: string; workflow_key: WorkflowKey; source_id: string; cron_expression: string; timezone: string; enabled: number; max_items: number | null; next_run_at: string; last_due_at: string | null; last_dispatch_id: string | null; created_at: string; updated_at: string; last_status?: string | null; last_finished_at?: string | null; running_count?: number; failed_count?: number };
export type WorkflowDefinition = { key: WorkflowKey; title: string; description: string; executor: WorkflowName; trigger: "scheduled" | "backfill"; cronExpression: string; scheduleLabel: string; timezone: string; maxItems: number; steps: WorkflowStageName[]; version: number; schedule: WorkflowSchedule | null; schedules?: WorkflowSchedule[] };
export type WorkflowDispatch = { id: string; schedule_id: string | null; workflow_key: WorkflowKey; source_id: string; archive_id: string | null; trigger: string; status: string; scheduled_for: string; available_at: string; claimed_by: string | null; claimed_at: string | null; started_at: string | null; finished_at: string | null; run_id: string | null; requested_by: string | null; error_code: string | null; error_message: string | null; created_at: string };
export type WorkflowEvent = { id: number; event_type: "dispatch" | "run" | "stage"; dispatch_id: string | null; run_id: string | null; archive_id: string | null; publication_id: string | null; stage: string | null; status: string; created_at: string };
export type SchedulerInstance = { id: string; environment: string; status: string; started_at: string; heartbeat_at: string; last_tick_at: string | null; last_error: string | null; healthy: boolean };
export type SchedulerMonitor = { items: WorkflowSchedule[]; instances: SchedulerInstance[]; stale_after_seconds: number };
export type Quarantine = { id: string; run_id: string; reason_code: string; source_row_ref: string | null; created_at: string };
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number; pages: number };
export type ListParameters = { page: number; pageSize: number; search: string; status: string };

export function listUrl(path: string, parameters: ListParameters): string {
  const query = new URLSearchParams({ page: String(parameters.page), pageSize: String(parameters.pageSize) });
  if (parameters.search) query.set("search", parameters.search);
  if (parameters.status) query.set("status", parameters.status);
  return `${path}?${query}`;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let body: Envelope<T>;
  try {
    body = await response.json() as Envelope<T>;
  } catch {
    throw new ApiError("The server returned an invalid response", response.status, null);
  }
  if (!response.ok || !body.success) {
    if (response.status === 401 && path !== "/v1/auth/session" && path !== "/v1/auth/login") window.location.assign("/admin/login");
    throw new ApiError(body.message, response.status, body.payload);
  }
  return body.payload;
}

export type InsightsMonth = { month: string; discovered: number; archived: number; canonicalized: number };
export type InsightsIndexStatus = { status: KnowledgeIndexStatus; count: number };
export type InsightsRunDay = { day: string; succeeded: number; failed: number; running: number };
export type InsightsMarket = { id: string; label: string; observations: number; products: number };
export type InsightsProduct = { id: string; label: string; category: string; observations: number };
export type InsightsVariety = { id: string; product_id: string; label: string; category: string; observations: number; average: number };
export type Insights = {
  documents: { total: number; by_month: InsightsMonth[]; index_status: InsightsIndexStatus[] };
  observations: { total: number; products: number; markets: number; first_observed: string | null; last_observed: string | null; by_week: Array<{ week: string; count: number }> };
  runs: { by_day: InsightsRunDay[]; succeeded_30d: number; failed_30d: number };
  quality: { complete: number; review_required: number; incomplete: number; not_configured: number; average_score: number | null };
  markets: InsightsMarket[];
  products: InsightsProduct[];
  varieties: InsightsVariety[];
};
export type PricePoint = { date: string; average: number; low: number; high: number; markets: number; moving_average: number | null; index: number | null };
export type PriceMarket = { id: string; label: string; average: number; low: number; high: number; observations: number };
export type PriceChange = { horizon_days: number; from_date: string; from_average: number; change: number; change_pct: number } | null;
export type PriceTrend = { direction: "rising" | "falling" | "stable"; slope_per_day: number; change_pct_per_30_days: number; points: number };
export type PriceMonth = { month: string; average: number; low: number; high: number; trading_days: number; change_pct: number | null };
export type PriceRangePreset = 30 | 90 | 180 | 365;
export const priceRangePresets: PriceRangePreset[] = [30, 90, 180, 365];
export type PriceRange = { from: string; to: string; days: number; preset: number | null };
export type RangeSelection = { preset: PriceRangePreset } | { from: string; to: string };
export type PriceSeries = {
  product: InsightsProduct;
  variety: InsightsVariety | null;
  varieties: InsightsVariety[];
  unit: string | null;
  range: PriceRange;
  points: PricePoint[];
  latest: PricePoint | null;
  previous: PricePoint | null;
  by_market: PriceMarket[];
  changes: { d7: PriceChange; d30: PriceChange; d90: PriceChange; window: PriceChange };
  trend: PriceTrend | null;
  volatility_pct: number | null;
  window_average: number | null;
  monthly: PriceMonth[];
};
export type Dish = {
  id: string;
  names: { en: string; si: string | null; si_latn: string | null; ta: string | null; ta_latn: string | null };
  category: string;
  roles: string[];
  meal_slots: string[];
  region: string;
  popularity: 1 | 2 | 3;
  prep_minutes: number;
  cook_minutes: number;
  difficulty: "easy" | "moderate" | "involved";
  diet: string[];
  protein_source: string[];
  spice: "none" | "mild" | "medium" | "hot";
  key_ingredients: string[];
  other_ingredients: string[];
  summary: string;
  occasions: string[];
  variants: string[];
  pairs_with: string[];
};
export type DishCoverage = { priced: number; total: number } | null;
export type DishSummary = Dish & { coverage: DishCoverage };
export type IngredientPrice = { product_id: string; label: string; sellers: number; cheapest: number; unit: string };
export type DishDetail = Dish & { ingredients: Array<{ product_id: string; label: string | null; price: IngredientPrice | null }>; pairs: Array<{ id: string; label: string }>; coverage: DishCoverage };
export type RecipeOverview = {
  dishes: number;
  by_category: Array<{ category: string; dishes: number }>;
  by_meal: Array<{ meal: string; dishes: number }>;
  coverage: { products: number; priced: number; dishes_fully_priced: number } | null;
  unpriced_ingredients: Array<{ ingredient: string; dishes: number }>;
  references: { channels: number; blogs: number; institutional: number };
  reviewed_at: string;
};
export type RecipeReferences = {
  channels: Array<{ id: string; name: string; url: string; languages: string[]; subscribers_approx: number | null; focus: string; sri_lankan_run: boolean | null }>;
  blogs: Array<{ id: string; name: string; url: string; languages: string[]; author: string | null; active: boolean | null; focus: string }>;
  institutional: Array<{ id: string; name: string; url: string; publisher: string; kind: string; licence: string | null; notes: string }>;
};
export type ExplorerComparison = "pooled" | "by_variety";
export type ExplorerVariety = { id: string; label: string; qualifier: string; sellers: number; base: boolean };
export type ExplorerProduct = { id: string; label: string; category: string; comparison: ExplorerComparison; varieties: ExplorerVariety[]; sellers: number; last_day: string | null; aliases: string[] };
export type ExplorerGroup = "wholesale" | "retail_market" | "supermarket";
export type ExplorerLatest = { market_id: string; market_label: string; market_type: string; group: ExplorerGroup; price_type: string; source_id: string; observed_on: string; unit: string; low: number; high: number; mid: number; products: number; varieties: string[] };
export type ExplorerPoint = { date: string; mid: number; low: number; high: number };
export type ExplorerSeries = { key: string; market_id: string; market_label: string; market_type: string; group: ExplorerGroup; price_type: string; unit: string; days: number; first: { date: string; mid: number }; last: { date: string; mid: number }; change_pct: number | null; points: ExplorerPoint[] };
export type ExplorerSummary = { group: ExplorerGroup; unit: string | null; sellers: number; average: number | null; lowest: ExplorerLatest | null; highest: ExplorerLatest | null };
export type ExplorerDetail = { product: ExplorerProduct; selected: string[]; range: PriceRange; bounds: { first: string | null; last: string | null }; latest: ExplorerLatest[]; summary: ExplorerSummary[]; markup_pct: number | null; series: ExplorerSeries[] };
export type BasketPoint = { date: string; index: number; products: number };
export type BasketMover = { item_id: string; product_id: string; label: string; category: string; change_pct: number; from_average: number; to_average: number; days: number };
export type BasketIndex = {
  range: PriceRange;
  base_from: string | null;
  base_to: string | null;
  points: BasketPoint[];
  latest: BasketPoint | null;
  change_pct_7d: number | null;
  change_pct_30d: number | null;
  change_pct_window: number | null;
  products_included: number;
  risers: BasketMover[];
  fallers: BasketMover[];
};

export function rangeQuery(selection: RangeSelection): URLSearchParams {
  return new URLSearchParams("preset" in selection ? { days: String(selection.preset) } : { from: selection.from, to: selection.to });
}
