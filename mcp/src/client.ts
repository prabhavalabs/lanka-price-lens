/**
 * The admin API, as a program sees it (docs/mcp.md). Everything goes over HTTPS with a token in
 * the Authorization header; the token is read from the environment once and never logged, echoed,
 * or returned in a tool's answer.
 */

export type Platform = "facebook" | "instagram";

export type ContentAsset = { id: string; position: number; media_type: string; width: number; height: number; bytes: number; url: string };
export type ContentSchedule = { id: string; item_id: string; platform: Platform; scheduled_for: string; status: "scheduled" | "queued" | "published" | "failed" | "cancelled"; post_url: string | null; error: string | null; published_at: string | null };
export type ContentItem = {
  id: string;
  kind: "image" | "carousel" | "text";
  title: string;
  caption: string;
  link: string | null;
  status: "draft" | "ready" | "archived";
  tags: string[];
  assets: ContentAsset[];
  schedules: ContentSchedule[];
  created_at: string;
  updated_at: string;
};
export type ContentPreview = { facebook: { caption: string; blocker: string | null }; instagram: { caption: string; blocker: string | null }; pictures: string[] };
export type CalendarEntry = ContentSchedule & { title: string; kind: ContentItem["kind"]; thumbnail: string | null };
export type ConnectedAccount = { platform: Platform; account_id: string; name: string; username: string | null; link: string | null; can_post: boolean; active: boolean; paused: boolean; token_status: "ok" | "invalid"; token_error: string | null; connected_at: string };
export type ChannelPost = { id: string; platform: Platform; status: string; title: string; created_at: string; sent_at: string | null; error: string | null; url: string | null };
export type DistributionStatus = { configured: boolean; accounts: ConnectedAccount[]; posts: ChannelPost[] };

export type Envelope<T> = { success: boolean; message: string; payload: T };

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type ClientConfig = { origin: string; token: string; fetch?: typeof fetch };

export type Client = ReturnType<typeof createClient>;

export function createClient(config: ClientConfig) {
  const request = config.fetch ?? fetch;
  const origin = config.origin.replace(/\/+$/u, "");

  const call = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    let response: Response;
    try {
      response = await request(`${origin}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (error) {
      // The address carries no secret, but the token is in the headers, so only the cause is kept.
      throw new ApiError(0, `The admin at ${origin} could not be reached: ${error instanceof Error ? error.message : "request failed"}`);
    }
    const body = (await response.json().catch(() => null)) as Envelope<T> | null;
    if (!response.ok || !body?.success) {
      const said = body?.message ?? `HTTP ${response.status}`;
      if (response.status === 401) throw new ApiError(401, `${said}. The token is wrong, revoked, or past its day.`);
      if (response.status === 403) throw new ApiError(403, `${said}`);
      throw new ApiError(response.status, said);
    }
    return body.payload;
  };

  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const query = (parts: Record<string, string | number | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(parts)) if (value !== undefined && value !== "") search.set(key, String(value));
    const text = search.toString();
    return text ? `?${text}` : "";
  };
  const base = "/v1/admin/distribution";

  return {
    origin,
    status: () => call<DistributionStatus>(base),
    listPosts: (input: { search?: string; status?: string; limit?: number }) => call<{ rows: ContentItem[]; total: number }>(`${base}/library${query({ search: input.search, status: input.status, limit: input.limit ?? 50 })}`),
    readPost: (id: string) => call<ContentItem>(`${base}/library/${encodeURIComponent(id)}`),
    createPost: (input: { title: string; caption: string; link?: string | null; tags?: string[]; status?: string }) => call<ContentItem>(`${base}/library`, json("POST", input)),
    updatePost: (id: string, input: { title: string; caption: string; link?: string | null; tags?: string[]; status?: string }) => call<ContentItem>(`${base}/library/${encodeURIComponent(id)}`, json("PUT", input)),
    deletePost: (id: string) => call<null>(`${base}/library/${encodeURIComponent(id)}`, { method: "DELETE" }),
    addPicture: (id: string, bytes: Uint8Array, mediaType: string) =>
      call<ContentItem>(`${base}/library/${encodeURIComponent(id)}/assets`, { method: "POST", headers: { "content-type": mediaType }, body: bytes as unknown as BodyInit }),
    removePicture: (id: string, assetId: string) => call<ContentItem>(`${base}/library/${encodeURIComponent(id)}/assets/${encodeURIComponent(assetId)}`, { method: "DELETE" }),
    previewPost: (id: string) => call<ContentPreview>(`${base}/library/${encodeURIComponent(id)}/preview`),
    schedulePost: (id: string, platform: Platform, scheduledFor: string) => call<ContentItem>(`${base}/library/${encodeURIComponent(id)}/schedule`, json("POST", { platform, scheduled_for: scheduledFor })),
    cancelSchedule: (scheduleId: string) => call<null>(`${base}/schedules/${encodeURIComponent(scheduleId)}`, { method: "DELETE" }),
    postSchedule: (scheduleId: string) => call<ContentItem>(`${base}/schedules/${encodeURIComponent(scheduleId)}/post`, { method: "POST" }),
    calendar: (from: string, to: string) => call<{ from: string; to: string; entries: CalendarEntry[] }>(`${base}/calendar${query({ from, to })}`),
  };
}
