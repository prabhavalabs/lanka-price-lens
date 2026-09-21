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
export type Run = { id: string; source_id: string; workflow: WorkflowName; parent_run_id: string | null; archive_id: string | null; artifact_id: string | null; definition_key?: WorkflowKey | null; definition_version?: number | null; dispatch_id?: string | null; scheduled_for?: string | null; environment?: string | null; trigger: string; status: string; started_at: string; finished_at: string | null; discovered_count: number; fetched_count: number; extracted_count?: number; parsed_count: number; quarantined_count: number; error_code: string | null; error_message: string | null; attempt?: number; retry_of?: string | null };
export type WorkflowLog = { id: number; level: "info" | "warning" | "error"; message: string; data: unknown; created_at: string };
export type WorkflowStep = { stage: WorkflowStageName; status: string; started_at: string | null; finished_at: string | null; duration_ms: number | null; input_count: number; output_count: number; warning_count: number; attempt_count: number; error_code: string | null; error_message: string | null; input: unknown; output: unknown; can_retry: boolean; retry_reason: string | null; missing_dependencies: string[]; logs: WorkflowLog[]; log_count: number };
export type RunWorkflow = { run: Run; stages: WorkflowStep[]; children: Run[] };
export type KnowledgeIndexStatus = "indexed" | "indexing" | "failed" | "not_indexed" | "reviewed";
export type KnowledgeItem = { publication_id: string; document_id: string; title: string; published_at: string | null; observed_from: string | null; observed_to: string | null; download_url: string; archive_id: string | null; r2_uri: string | null; r2_key: string | null; artifact_id: string | null; run_id: string | null; original_filename: string; fetched_at: string | null; byte_size: number | null; sha256: string | null; status: string; index_status: KnowledgeIndexStatus; pdf_type: string | null; page_count: number | null; confidence: number | null; ocr_page_count: number; parser_strategy: string | null; parser_confidence: number | null; parsed_count: number; canonical_count: number; quarantined_count: number; quality_status: string | null; completeness_score: number | null; item_coverage: number | null; market_coverage: number | null; cell_coverage: number | null; mapping_coverage: number | null; processing_dispatch_id: string | null; processing_run_id: string | null; processing_status: string | null; processing_started_at: string | null; processing_finished_at: string | null; processing_error_code: string | null; processing_error_message: string | null };
export type KnowledgeListItem = Pick<KnowledgeItem, "publication_id" | "document_id" | "title" | "published_at" | "download_url" | "archive_id" | "byte_size" | "status" | "index_status" | "pdf_type" | "page_count" | "canonical_count" | "processing_dispatch_id" | "processing_run_id" | "processing_status">;
export type WorkflowKey = "latest_document_collection" | "historical_backfill" | "document_processing_pipeline" | "retail_price_capture";
export type WorkflowSchedule = { id: string; workflow_key: WorkflowKey; source_id: string; cron_expression: string; timezone: string; enabled: number; max_items: number | null; next_run_at: string; last_due_at: string | null; last_dispatch_id: string | null; created_at: string; updated_at: string; last_status?: string | null; last_finished_at?: string | null; running_count?: number; failed_count?: number };
export type WorkflowDefinition = { key: WorkflowKey; title: string; description: string; executor: WorkflowName; trigger: "scheduled" | "backfill"; cronExpression: string; scheduleLabel: string; timezone: string; maxItems: number; steps: WorkflowStageName[]; version: number; schedule: WorkflowSchedule | null; schedules?: WorkflowSchedule[] };
export type WorkflowDispatch = { id: string; schedule_id: string | null; workflow_key: WorkflowKey; source_id: string; archive_id: string | null; trigger: string; status: string; scheduled_for: string; available_at: string; claimed_by: string | null; claimed_at: string | null; started_at: string | null; finished_at: string | null; run_id: string | null; requested_by: string | null; error_code: string | null; error_message: string | null; created_at: string };
export type WorkflowEvent = { id: number; event_type: "dispatch" | "run" | "stage"; dispatch_id: string | null; run_id: string | null; archive_id: string | null; publication_id: string | null; stage: string | null; status: string; created_at: string };
export type SchedulerInstance = { id: string; environment: string; status: string; started_at: string; heartbeat_at: string; last_tick_at: string | null; last_error: string | null; healthy: boolean };
export type AutomationTimer = { workflow: string; label: string; expected: boolean; last_run_at: string | null; last_status: string | null; fresh: boolean };
export type AutomationStatus = { mode: "scheduler" | "timers" | "none"; healthy: boolean; stale_after_hours: number; timers: AutomationTimer[] };
export type SchedulerMonitor = { items: WorkflowSchedule[]; instances: SchedulerInstance[]; stale_after_seconds: number; automation: AutomationStatus };
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
  recipes: { total: number; with_si: number; with_ta: number; reviewed: { en: number; si: number; ta: number }; review_needed: number; ingredients: number };
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

export type FeedbackKind = "feedback" | "bug";
export type FeedbackStatus = "new" | "seen" | "done";
export type FeedbackItem = { id: string; kind: FeedbackKind; message: string; email: string | null; page: string | null; user_agent: string | null; status: FeedbackStatus; created_at: string; updated_at: string };
export type FeedbackList = { items: FeedbackItem[]; total: number; page: number; pageSize: number; counts: Record<FeedbackStatus, number> };

export type AccountStatus = "active" | "disabled";
/** An account as `GET /v1/admin/accounts` lists it: the row without its password hash, plus what it keeps. */
export type AdminAccount = {
  id: string;
  email: string;
  email_verified_at: string | null;
  display_name: string;
  avatar_url: string | null;
  locale: "en" | "si" | "ta";
  status: AccountStatus;
  failed_login_count: number;
  locked_until: string | null;
  preferences: { notify_email: boolean; notify_digest: boolean; notify_alerts: boolean };
  created_at: string;
  updated_at: string;
  has_password: boolean;
  /** Linked sign-in providers ("google"), when the API includes them; an account without a password signed up with Google. */
  identities: ("google")[];
  menus: number;
  recipes: number;
};
export type AdminAccountUpdate = AdminAccount & { sessions_revoked: number };

function jsonInit(method: "POST" | "PUT" | "PATCH", body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

/** Every mail the site sends, in the order the Mail page lists them. */
export const mailKinds = ["verify_email", "welcome", "reset_password", "password_changed", "change_email", "email_changed", "account_deleted", "recipes_daily", "deals_daily", "price_alerts"] as const;
export type MailKind = (typeof mailKinds)[number];
/** The editable wording of a mail; the layout around it stays in code. */
export type MailFields = { subject: string; preheader: string; heading: string; intro: string; outro: string; button_label: string; reason: string };
export const mailFieldNames = ["subject", "preheader", "heading", "intro", "outro", "button_label", "reason"] as const satisfies ReadonlyArray<keyof MailFields>;
export type MailPlaceholder = { name: string; description: string };
export type MailTemplate = { kind: MailKind; fields: MailFields; defaults: MailFields; placeholders: MailPlaceholder[]; edited: boolean; updated_at: string | null; updated_by: string | null };
export type MailPreview = { subject: string; html: string; text: string };
export type MailTestResult = { ok: boolean; reference: string };

export const mailTemplatesApi = {
  list: (init?: RequestInit) => api<MailTemplate[]>("/v1/admin/mail/templates", init),
  get: (kind: MailKind, init?: RequestInit) => api<MailTemplate>(`/v1/admin/mail/templates/${kind}`, init),
  save: (kind: MailKind, fields: Partial<MailFields>) => api<MailTemplate>(`/v1/admin/mail/templates/${kind}`, jsonInit("PUT", { fields })),
  reset: (kind: MailKind) => api<MailTemplate>(`/v1/admin/mail/templates/${kind}`, { method: "DELETE" }),
  preview: (kind: MailKind, fields?: Partial<MailFields>, init?: RequestInit) => api<MailPreview>(`/v1/admin/mail/templates/${kind}/preview`, { ...jsonInit("POST", fields ? { fields } : {}), ...init }),
  test: (kind: MailKind, fields?: Partial<MailFields>) => api<MailTestResult>(`/v1/admin/mail/templates/${kind}/test`, jsonInit("POST", fields ? { fields } : {})),
};

export const newsletterKinds = ["recipes_daily", "deals_daily", "price_alerts"] as const satisfies ReadonlyArray<MailKind>;
export type NewsletterKind = (typeof newsletterKinds)[number];
export type NewsletterRun = { id: string; kind: NewsletterKind; day: string; trigger: string; status: string; started_at: string; finished_at: string | null; recipients: number; sent: number; skipped: number; failed: number; error: string | null };
export type NewsletterDelivery = { account_id: string; email: string; subject: string };
/** What `POST /v1/admin/newsletters/run` answers: the run row, plus who would have received it when it was a dry run. */
export type NewsletterRunReport = NewsletterRun & { deliveries?: NewsletterDelivery[] };
export type NewsletterRunRequest = { kind: NewsletterKind; day?: string; dry_run?: boolean; force?: boolean };

export const newslettersApi = {
  runs: (query: { kind?: NewsletterKind; limit?: number } = {}, init?: RequestInit) => {
    const search = new URLSearchParams();
    if (query.kind) search.set("kind", query.kind);
    if (query.limit) search.set("limit", String(query.limit));
    const suffix = search.size ? `?${search}` : "";
    return api<NewsletterRun[]>(`/v1/admin/newsletters/runs${suffix}`, init);
  },
  run: (request: NewsletterRunRequest) => api<NewsletterRunReport>("/v1/admin/newsletters/run", jsonInit("POST", request)),
};

export type DealKind = "drop" | "offer" | "cheapest";
export type DealBaseline = "yesterday" | "median14" | "other_stores";
/** Prices are in minor units (cents); `pct` is signed, so -21.3 means down 21.3 %. */
export type Deal = { product_id: string; label: string; unit: string; market_id: string; market: string; now_minor: number; was_minor: number; was_on: string; pct: number; kind: DealKind; baseline: DealBaseline; url: string };
export type EssentialWatch = { product_id: string; label: string; unit: string; cheapest: { market_id: string; market: string; price_minor: number }; change_pct: number | null; trend: "down" | "flat" | "up" };
export type DealsDay = {
  day: string;
  computed_at: string;
  stores: Array<{ market_id: string; label: string; series: number; deals: number }>;
  deals: Deal[];
  movers_up: Deal[];
  essentials: EssentialWatch[];
  stats: { series: number; fresh: number; considered: number };
};

export const dealsApi = {
  /** The latest computed day; a 503 with code `DEALS_UNAVAILABLE` (an `ApiError` with status 503) when there is none yet. */
  today: (init?: RequestInit) => api<DealsDay>("/v1/admin/deals/today", init),
  compute: () => api<DealsDay>("/v1/admin/deals/compute", { method: "POST" }),
};

/** What signed-in people give back on the recipe section (docs/community.md), as the owner reviews it under /v1/admin/community. */
export const reviewStatuses = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];
export const translationStatuses = ["new", "reviewed", "applied"] as const;
export type TranslationStatus = (typeof translationStatuses)[number];
export const submissionKinds = ["request", "recipe"] as const;
export type SubmissionKind = (typeof submissionKinds)[number];
export type TranslationLanguage = "si" | "ta";
export type TranslationVerdict = "correct" | "incorrect";
export type ProposalUnitHint = "kg" | "g" | "l" | "ml" | "piece";
export const reactionSorts = ["score", "dislikes", "recent"] as const;
export type ReactionSort = (typeof reactionSorts)[number];
/** Who made a contribution; a deleted account answers "(deleted account)" and "Unknown". */
export type Contributor = { email: string; display_name: string };
export type CommunityOverview = { pending_submissions: number; new_translations: number; pending_products: number; reactions: { likes: number; dislikes: number; dishes: number } };
/** A recipe request or a submitted recipe; `recipe` is null in lists and carries the recipe JSON on the detail route. */
export type RecipeSubmissionRow = Contributor & {
  id: string;
  account_id: string;
  kind: SubmissionKind;
  name: string;
  notes: string | null;
  source_recipe_id: string | null;
  recipe: Record<string, unknown> | null;
  status: ReviewStatus;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export type TranslationFeedbackRow = Contributor & {
  id: string;
  account_id: string;
  dish_id: string;
  /** The dish's English name; null when the catalogue no longer carries the dish. */
  dish_name: string | null;
  language: TranslationLanguage;
  verdict: TranslationVerdict;
  correction: string | null;
  note: string | null;
  status: TranslationStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export type ProductProposalRow = Contributor & {
  id: string;
  account_id: string;
  label: string;
  category: string | null;
  unit_hint: ProposalUnitHint | null;
  note: string | null;
  status: ReviewStatus;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};
export type DishReactionRow = { dish_id: string; name: string | null; likes: number; dislikes: number; score: number; last_at: string };
export type ReactionRow = Contributor & { value: "up" | "down"; updated_at: string };
/** What `GET /reactions/:dishId` answers: the dish and everyone who reacted to it, newest first. */
export type DishReactions = { dish_id: string; name: string | null; reactions: ReactionRow[] };
export type ReviewBody = { status: ReviewStatus; review_note?: string };

function communityQuery(values: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") search.set(key, String(value));
  return search.size ? `?${search}` : "";
}

export const communityApi = {
  overview: (init?: RequestInit) => api<CommunityOverview>("/v1/admin/community/overview", init),
  submissions: (query: { status?: ReviewStatus | undefined; kind?: SubmissionKind | undefined; page?: number | undefined; pageSize?: number | undefined }, init?: RequestInit) =>
    api<Page<RecipeSubmissionRow>>(`/v1/admin/community/submissions${communityQuery(query)}`, init),
  submission: (id: string, init?: RequestInit) => api<RecipeSubmissionRow>(`/v1/admin/community/submissions/${encodeURIComponent(id)}`, init),
  reviewSubmission: (id: string, body: ReviewBody) => api<RecipeSubmissionRow>(`/v1/admin/community/submissions/${encodeURIComponent(id)}`, jsonInit("PATCH", body)),
  translations: (query: { status?: TranslationStatus | undefined; page?: number | undefined; pageSize?: number | undefined }, init?: RequestInit) =>
    api<Page<TranslationFeedbackRow>>(`/v1/admin/community/translations${communityQuery(query)}`, init),
  reviewTranslation: (id: string, status: TranslationStatus) => api<TranslationFeedbackRow>(`/v1/admin/community/translations/${encodeURIComponent(id)}`, jsonInit("PATCH", { status })),
  products: (query: { status?: ReviewStatus | undefined; page?: number | undefined; pageSize?: number | undefined }, init?: RequestInit) =>
    api<Page<ProductProposalRow>>(`/v1/admin/community/products${communityQuery(query)}`, init),
  reviewProduct: (id: string, body: ReviewBody) => api<ProductProposalRow>(`/v1/admin/community/products/${encodeURIComponent(id)}`, jsonInit("PATCH", body)),
  reactions: (query: { sort?: ReactionSort | undefined; page?: number | undefined; pageSize?: number | undefined }, init?: RequestInit) =>
    api<Page<DishReactionRow>>(`/v1/admin/community/reactions${communityQuery(query)}`, init),
  reactionsOf: (dishId: string, init?: RequestInit) => api<DishReactions>(`/v1/admin/community/reactions/${encodeURIComponent(dishId)}`, init),
};

// The distribution channels (docs/distribution.md): Facebook and Instagram, the content library, the calendar.
export type Platform = "facebook" | "instagram";
export type ConnectedAccount = {
  platform: Platform;
  account_id: string;
  name: string;
  username: string | null;
  link: string | null;
  picture: string | null;
  parent_id: string | null;
  can_post: boolean;
  active: boolean;
  paused: boolean;
  token_status: "ok" | "invalid";
  token_error: string | null;
  token_checked_at: string | null;
  token_expires_at: string | null;
  connected_by: string | null;
  connected_at: string;
};
export type ChannelPost = { id: string; platform: Platform; account_id: string; status: "queued" | "sending" | "sent" | "dead"; title: string; attempts: number; created_at: string; sent_at: string | null; next_attempt_at: string | null; error: string | null; url: string | null };
export type DistributionStatus = { configured: boolean; app_id: string | null; redirect_uri: string; accounts: ConnectedAccount[]; posts: ChannelPost[]; publishing_limit?: { used: number; cap: number } | null };
export type DealsPreview = { day: string; requested_day: string; platform: Platform; ready: boolean; caption: string | null; image_url: string | null; rows: Array<{ label: string; store: string; note: string; now: string; was: string | null; pct: number }> };

export type ContentAsset = { id: string; position: number; file: string; media_type: string; width: number; height: number; bytes: number; url: string };
export type ContentSchedule = { id: string; item_id: string; platform: Platform; scheduled_for: string; status: "scheduled" | "queued" | "published" | "failed" | "cancelled"; outbox_id: string | null; post_url: string | null; error: string | null; published_at: string | null; created_at: string };
export type ContentItem = { id: string; kind: "image" | "carousel" | "text"; title: string; caption: string; link: string | null; status: "draft" | "ready" | "archived"; tags: string[]; assets: ContentAsset[]; schedules: ContentSchedule[]; created_by: string | null; created_at: string; updated_at: string };
export type ContentPreview = { facebook: { caption: string; blocker: string | null }; instagram: { caption: string; blocker: string | null }; pictures: string[] };
export type CalendarEntry = ContentSchedule & { title: string; kind: ContentItem["kind"]; thumbnail: string | null };
export type ContentDraft = { title: string; caption: string; link: string | null; status?: ContentItem["status"]; tags: string[] };

/** Where the browser goes to open Facebook's consent screen; a navigation, not a fetch. */
export const distributionConnectPath = "/v1/admin/distribution/connect";

const libraryQuery = (query: { status?: string; search?: string; limit?: number; offset?: number }): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
};

export const distributionApi = {
  status: (init?: RequestInit) => api<DistributionStatus>("/v1/admin/distribution", init),
  activate: (platform: Platform, accountId: string) => api<DistributionStatus>(`/v1/admin/distribution/accounts/${platform}/${encodeURIComponent(accountId)}/activate`, { method: "POST" }),
  pause: (platform: Platform, accountId: string, paused: boolean) => api<DistributionStatus>(`/v1/admin/distribution/accounts/${platform}/${encodeURIComponent(accountId)}/pause`, jsonInit("POST", { paused })),
  disconnect: (platform: Platform, accountId: string) => api<DistributionStatus>(`/v1/admin/distribution/accounts/${platform}/${encodeURIComponent(accountId)}`, { method: "DELETE" }),
  check: (platform: Platform) => api<DistributionStatus>(`/v1/admin/distribution/accounts/${platform}/check`, { method: "POST" }),
  dealsPreview: (platform: Platform, init?: RequestInit) => api<DealsPreview>(`/v1/admin/distribution/deals/preview?platform=${platform}`, init),
  postDeals: (platform: Platform) => api<DistributionStatus & { post: ChannelPost | null }>("/v1/admin/distribution/deals/post", jsonInit("POST", { platform })),

  library: (query: { status?: string; search?: string; limit?: number; offset?: number } = {}, init?: RequestInit) =>
    api<{ rows: ContentItem[]; total: number; carousel_max: number }>(`/v1/admin/distribution/library${libraryQuery(query)}`, init),
  item: (id: string, init?: RequestInit) => api<ContentItem>(`/v1/admin/distribution/library/${encodeURIComponent(id)}`, init),
  createItem: (draft: ContentDraft) => api<ContentItem>("/v1/admin/distribution/library", jsonInit("POST", draft)),
  saveItem: (id: string, draft: ContentDraft) => api<ContentItem>(`/v1/admin/distribution/library/${encodeURIComponent(id)}`, jsonInit("PUT", draft)),
  deleteItem: (id: string) => api<null>(`/v1/admin/distribution/library/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // The picture is the body itself; the server re-encodes it, so the browser sends the file untouched.
  addPicture: (id: string, file: File) => api<ContentItem>(`/v1/admin/distribution/library/${encodeURIComponent(id)}/assets`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file }),
  removePicture: (id: string, assetId: string) => api<ContentItem>(`/v1/admin/distribution/library/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }),
  preview: (id: string, init?: RequestInit) => api<ContentPreview>(`/v1/admin/distribution/library/${encodeURIComponent(id)}/preview`, init),

  schedule: (id: string, platform: Platform, scheduledFor: string) => api<ContentItem>(`/v1/admin/distribution/library/${encodeURIComponent(id)}/schedule`, jsonInit("POST", { platform, scheduled_for: scheduledFor })),
  cancelSchedule: (scheduleId: string) => api<null>(`/v1/admin/distribution/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" }),
  postSchedule: (scheduleId: string) => api<ContentItem>(`/v1/admin/distribution/schedules/${encodeURIComponent(scheduleId)}/post`, { method: "POST" }),
  calendar: (from: string, to: string, init?: RequestInit) => api<{ from: string; to: string; entries: CalendarEntry[] }>(`/v1/admin/distribution/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, init),
  tick: () => api<{ due: number; published: number; failed: number }>("/v1/admin/distribution/tick", { method: "POST" }),
};
