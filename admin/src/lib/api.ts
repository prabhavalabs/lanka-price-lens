export type Envelope<T> = { success: boolean; message: string; payload: T };
export type AdminUser = { id: string; email: string };
export type LoginFailure =
  | { reason: "invalid_credentials"; attempts_remaining: number }
  | { reason: "account_locked"; attempts_remaining: 0; locked_until: string; retry_after_seconds: number };
export type Overview = { sources: number; pdfs: number; running: number; failed: number; quarantined: number };
export type Source = { id: string; name: string; owner: string; rights_status: string; review_due_at: string; enabled: number; state: string; last_parse_at: string | null };
export type WorkflowName = "source_sync" | "pdf_processing" | "legacy_ingestion";
export type WorkflowStageName = "check_source" | "compare_inventory" | "download_new_pdfs" | "upload_to_r2" | "record_pdf_metadata" | "retrieve_pdf" | "parse_pdf" | "extract_data" | "validate_data" | "insert_data" | "assess_completeness" | "canonicalize_data" | "crawl" | "download" | "process" | "validate" | "store" | "rights" | "discover" | "fetch" | "extract" | "parse" | "map" | "canonicalize" | "release";
export type Run = { id: string; source_id: string; workflow: WorkflowName; parent_run_id: string | null; archive_id: string | null; artifact_id: string | null; definition_key?: WorkflowKey | null; definition_version?: number | null; dispatch_id?: string | null; scheduled_for?: string | null; environment?: string | null; trigger: string; status: string; started_at: string; finished_at: string | null; discovered_count: number; fetched_count: number; extracted_count?: number; parsed_count: number; quarantined_count: number; error_code: string | null; error_message: string | null };
export type WorkflowLog = { id: number; level: "info" | "warning" | "error"; message: string; data: unknown; created_at: string };
export type WorkflowStep = { stage: WorkflowStageName; status: string; started_at: string | null; finished_at: string | null; duration_ms: number | null; input_count: number; output_count: number; warning_count: number; attempt_count: number; error_code: string | null; error_message: string | null; input: unknown; output: unknown; can_retry: boolean; retry_reason: string | null; missing_dependencies: string[]; logs: WorkflowLog[]; log_count: number };
export type RunWorkflow = { run: Run; stages: WorkflowStep[]; children: Run[] };
export type KnowledgeItem = { publication_id: string; title: string; published_at: string | null; observed_from: string | null; observed_to: string | null; download_url: string; archive_id: string | null; r2_uri: string | null; r2_key: string | null; artifact_id: string | null; run_id: string | null; original_filename: string; fetched_at: string | null; byte_size: number | null; sha256: string | null; status: string; pdf_type: string | null; page_count: number | null; confidence: number | null; ocr_page_count: number; parser_strategy: string | null; parser_confidence: number | null; parsed_count: number; canonical_count: number; quarantined_count: number; quality_status: string | null; completeness_score: number | null; item_coverage: number | null; market_coverage: number | null; cell_coverage: number | null; mapping_coverage: number | null; processing_run_id: string | null; processing_status: string | null; processing_started_at: string | null; processing_finished_at: string | null; processing_error_code: string | null; processing_error_message: string | null };
export type WorkflowKey = "latest_document_collection" | "historical_backfill" | "document_processing_pipeline";
export type WorkflowSchedule = { id: string; workflow_key: WorkflowKey; source_id: string; cron_expression: string; timezone: string; enabled: number; max_items: number | null; next_run_at: string; last_due_at: string | null; last_dispatch_id: string | null; created_at: string; updated_at: string; last_status?: string | null; last_finished_at?: string | null; running_count?: number; failed_count?: number };
export type WorkflowDefinition = { key: WorkflowKey; title: string; description: string; executor: WorkflowName; trigger: "scheduled" | "backfill"; cronExpression: string; scheduleLabel: string; timezone: string; maxItems: number; steps: WorkflowStageName[]; version: number; schedule: WorkflowSchedule | null };
export type WorkflowDispatch = { id: string; schedule_id: string | null; workflow_key: WorkflowKey; source_id: string; archive_id: string | null; trigger: string; status: string; scheduled_for: string; available_at: string; claimed_by: string | null; claimed_at: string | null; started_at: string | null; finished_at: string | null; run_id: string | null; requested_by: string | null; error_code: string | null; error_message: string | null; created_at: string };
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
