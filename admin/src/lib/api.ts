export type Envelope<T> = { success: boolean; message: string; payload: T };
export type AdminUser = { id: string; email: string };
export type Overview = { sources: number; pdfs: number; running: number; failed: number; quarantined: number };
export type Source = { id: string; name: string; owner: string; rights_status: string; review_due_at: string; enabled: number; state: string; last_parse_at: string | null };
export type Run = { id: string; source_id: string; trigger: string; status: string; started_at: string; finished_at: string | null; discovered_count: number; fetched_count: number; parsed_count: number; quarantined_count: number; error_code: string | null; error_message: string | null };
export type Pdf = { artifact_id: string; run_id: string; original_filename: string; fetched_at: string; byte_size: number; sha256: string; status: string; pdf_type: string | null; page_count: number | null; confidence: number | null; ocr_page_count: number; parsed_count: number; quarantined_count: number };
export type Quarantine = { id: string; run_id: string; reason_code: string; source_row_ref: string | null; created_at: string };
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number; pages: number };

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  let body: Envelope<T>;
  try {
    body = await response.json() as Envelope<T>;
  } catch {
    throw new ApiError("The server returned an invalid response", response.status);
  }
  if (!response.ok || !body.success) {
    if (response.status === 401 && path !== "/v1/auth/session" && path !== "/v1/auth/login") window.location.assign("/admin/login");
    throw new ApiError(body.message, response.status);
  }
  return body.payload;
}
