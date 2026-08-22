export type Envelope<T> = { success: boolean; message: string; payload: T };
export type AdminUser = { id: string; email: string };
export type LoginFailure =
  | { reason: "invalid_credentials"; attempts_remaining: number }
  | { reason: "account_locked"; attempts_remaining: 0; locked_until: string; retry_after_seconds: number };
export type Overview = { sources: number; pdfs: number; running: number; failed: number; quarantined: number };
export type Source = { id: string; name: string; owner: string; rights_status: string; review_due_at: string; enabled: number; state: string; last_parse_at: string | null };
export type WorkflowName = "source_sync" | "pdf_processing" | "legacy_ingestion";
export type WorkflowStageName = "check_source" | "compare_inventory" | "download_new_pdfs" | "upload_to_r2" | "record_pdf_metadata" | "retrieve_pdf" | "parse_pdf" | "extract_data" | "validate_data" | "insert_data" | "crawl" | "download" | "process" | "validate" | "store" | "rights" | "discover" | "fetch" | "extract" | "parse" | "map" | "canonicalize" | "release";
export type Run = { id: string; source_id: string; workflow: WorkflowName; parent_run_id: string | null; archive_id: string | null; artifact_id: string | null; trigger: string; status: string; started_at: string; finished_at: string | null; discovered_count: number; fetched_count: number; extracted_count?: number; parsed_count: number; quarantined_count: number; error_code: string | null; error_message: string | null };
export type WorkflowLog = { id: number; level: "info" | "warning" | "error"; message: string; data: unknown; created_at: string };
export type WorkflowStep = { stage: WorkflowStageName; status: string; started_at: string | null; finished_at: string | null; duration_ms: number | null; input_count: number; output_count: number; warning_count: number; attempt_count: number; error_code: string | null; error_message: string | null; input: unknown; output: unknown; can_retry: boolean; retry_reason: string | null; missing_dependencies: string[]; logs: WorkflowLog[]; log_count: number };
export type RunWorkflow = { run: Run; stages: WorkflowStep[]; children: Run[] };
export type KnowledgeItem = { publication_id: string; title: string; published_at: string | null; observed_from: string | null; observed_to: string | null; download_url: string; archive_id: string | null; r2_uri: string | null; r2_key: string | null; artifact_id: string | null; run_id: string | null; original_filename: string; fetched_at: string | null; byte_size: number | null; sha256: string | null; status: string; pdf_type: string | null; page_count: number | null; confidence: number | null; ocr_page_count: number; parsed_count: number; quarantined_count: number };
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
