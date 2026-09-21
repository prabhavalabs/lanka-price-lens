import { createHmac } from "node:crypto";

import { bodyExcerpt, classifyStatus, failure, mask, type Channel, type Delivery, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { facebookPostLimit, facebookText } from "../render/facebook.ts";

/**
 * Facebook Pages through the Graph API. A target's address is a Page id; the Page's access
 * token is looked up when a post is sent, so connecting or reconnecting a Page in the
 * application takes effect without a restart and no token ever rides in the outbox. A message
 * with an image is published as a photo with the text as its caption (Facebook fetches the
 * picture from the address given); one without goes to the feed, with the first action as
 * the link Facebook previews.
 *
 * Only a Page is ever posted to. The Graph API offers no publishing to a person's profile,
 * and an application in development mode publishes posts only its own team can see.
 */

export const facebookGraphVersion = "v25.0";
/** What connecting a Page asks the person for: the list of their Pages, posting to one, and reading what was posted. `business_management` reaches Pages held in a business portfolio. */
export const facebookScopes = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management"] as const;

export type FacebookConfig = {
  /** The Page's access token, or null when the Page is not connected (any more). */
  pageToken: (pageId: string) => string | null | Promise<string | null>;
  /** With it every call carries an `appsecret_proof`, which the app can be set to require. */
  appSecret?: string | undefined;
  fetch?: FetchLike | undefined;
  apiBase?: string | undefined;
  version?: string | undefined;
};

export type FacebookApp = { appId: string; appSecret: string; fetch?: FetchLike | undefined; apiBase?: string | undefined; version?: string | undefined };

type GraphError = { message?: string; type?: string; code?: number; error_subcode?: number };
type GraphResult = { id?: string; post_id?: string; error?: GraphError };

/** The token is dead or lacks the permission: only connecting the Page again helps. */
const goneCodes = new Set([10, 102, 190]);
/** Facebook's own "try again later": a passing fault or one of its rate limits (application, person, Page). */
const retryCodes = new Set([1, 2, 4, 17, 32, 341, 613, 80001]);
/** The picture could not be fetched from its address; ours is rendered on demand and may have been slow. */
const pictureCodes = new Set([324]);
const rateLimitWaitMs = 3_600_000;

const graphBase = (config: { apiBase?: string | undefined; version?: string | undefined }): string => `${config.apiBase ?? "https://graph.facebook.com"}/${config.version ?? facebookGraphVersion}`;

/** `appsecret_proof`: an HMAC of the token under the app secret, which shows a call comes from the app's own server. */
export function facebookProof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

export function classifyGraphError(error: GraphError | undefined, status: number, headers?: Headers): { retryable: boolean; gone: boolean; retryAfterMs: number | undefined } {
  const code = error?.code;
  if (code !== undefined) {
    if (goneCodes.has(code) || (code >= 200 && code <= 299)) return { retryable: false, gone: true, retryAfterMs: undefined };
    if (pictureCodes.has(code)) return { retryable: true, gone: false, retryAfterMs: undefined };
    if (retryCodes.has(code)) return { retryable: true, gone: false, retryAfterMs: code === 1 || code === 2 ? undefined : rateLimitWaitMs };
    // Everything else Facebook names (a refused post, a duplicate, a bad parameter) will be refused again.
    return { retryable: false, gone: false, retryAfterMs: undefined };
  }
  const classified = classifyStatus(status, headers);
  return { ...classified, gone: false };
}

export function createFacebookChannel(config: FacebookConfig): Channel {
  const request = config.fetch ?? fetch;
  const base = graphBase(config);
  const call = async (path: string, token: string, fields: Record<string, string>): Promise<Delivery> => {
    const body = new URLSearchParams({ ...fields, access_token: token, ...(config.appSecret ? { appsecret_proof: facebookProof(token, config.appSecret) } : {}) });
    let response: Response;
    try {
      // The token travels in the body, never in the address, so it stays out of any log of requests.
      response = await request(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(), signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      return failure(`FACEBOOK_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
    }
    const payload = (await response.clone().json().catch(() => null)) as GraphResult | null;
    const reference = payload?.post_id ?? payload?.id;
    if (response.ok && reference && !payload?.error) return { ok: true, reference };
    const detail = payload?.error?.message ?? (await bodyExcerpt(response));
    const code = payload?.error?.code;
    const label = code === undefined ? `FACEBOOK_HTTP_${response.status}` : `FACEBOOK_${code}${payload?.error?.error_subcode ? `_${payload.error.error_subcode}` : ""}`;
    return failure(`${label}: ${detail}`.slice(0, 500), classifyGraphError(payload?.error, response.status, response.headers));
  };
  return {
    kind: "facebook",
    describe: (target) => `facebook:${mask(target.address, 3)}`,
    send: async (target: Target, message: Message) => {
      if (!/^\d{5,32}$/u.test(target.address)) return failure("FACEBOOK_PAGE_INVALID: a Page id is digits only");
      const token = await config.pageToken(target.address);
      if (!token) return failure("FACEBOOK_NOT_CONNECTED: no access token for this Page", { gone: true });
      const text = facebookText(message, facebookPostLimit);
      if (message.image) return call(`${target.address}/photos`, token, { url: message.image.url, caption: text, published: "true" });
      const link = message.actions[0]?.url;
      return call(`${target.address}/feed`, token, { message: text, ...(link ? { link } : {}) });
    },
  };
}

/** Where a post can be opened: Facebook resolves "<page id>_<post id>" on its own. */
export function facebookPostUrl(reference: string): string {
  return `https://www.facebook.com/${encodeURIComponent(reference)}`;
}

// --- Connecting a Page: Facebook Login, then the Page's own long-lived token ----------------

/** The consent screen. `state` comes back untouched on the redirect and must be checked there. */
export function facebookLoginUrl(input: { appId: string; redirectUri: string; state: string; scopes?: readonly string[] | undefined; version?: string | undefined }): string {
  const url = new URL(`https://www.facebook.com/${input.version ?? facebookGraphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (input.scopes ?? facebookScopes).join(","));
  return url.toString();
}

export class FacebookGraphError extends Error {
  readonly code: number | null;
  constructor(step: string, detail: string, code: number | null) {
    super(`${step}: ${detail}`.slice(0, 500));
    this.code = code;
  }
}

async function graphGet<T>(app: Pick<FacebookApp, "fetch" | "apiBase" | "version">, step: string, path: string, query: Record<string, string>): Promise<T> {
  const request = app.fetch ?? fetch;
  let response: Response;
  try {
    response = await request(`${graphBase(app)}/${path}?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    // The address holds a secret or a token, so only the cause is kept, never the request.
    throw new FacebookGraphError(step, `network: ${error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.name) : "failed"}`, null);
  }
  const payload = (await response.json().catch(() => null)) as (T & { error?: GraphError }) | null;
  if (!response.ok || !payload || payload.error) throw new FacebookGraphError(step, payload?.error?.message ?? `HTTP ${response.status}`, payload?.error?.code ?? null);
  return payload;
}

/** Trades the code from the redirect for the person's short-lived token. `redirectUri` must be the one the consent screen was opened with. */
export async function exchangeFacebookCode(app: FacebookApp, code: string, redirectUri: string): Promise<string> {
  const payload = await graphGet<{ access_token?: string }>(app, "FACEBOOK_CODE_EXCHANGE", "oauth/access_token", { client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code });
  if (!payload.access_token) throw new FacebookGraphError("FACEBOOK_CODE_EXCHANGE", "no access token in the answer", null);
  return payload.access_token;
}

/** The person's long-lived token (about sixty days). Page tokens read with it do not expire. */
export async function extendFacebookToken(app: FacebookApp, userToken: string): Promise<string> {
  const payload = await graphGet<{ access_token?: string }>(app, "FACEBOOK_TOKEN_EXTEND", "oauth/access_token", { grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: userToken });
  if (!payload.access_token) throw new FacebookGraphError("FACEBOOK_TOKEN_EXTEND", "no access token in the answer", null);
  return payload.access_token;
}

export type FacebookPage = { id: string; name: string; token: string; link: string | null; canPost: boolean };

/** The Pages the person let the app manage, each with its own token. `canPost` is false when their role on the Page does not include creating content. */
export async function listFacebookPages(app: FacebookApp, userToken: string): Promise<{ person: string | null; pages: FacebookPage[] }> {
  const proof = { appsecret_proof: facebookProof(userToken, app.appSecret) };
  const me = await graphGet<{ name?: string }>(app, "FACEBOOK_PROFILE", "me", { fields: "name", access_token: userToken, ...proof });
  const pages: FacebookPage[] = [];
  let after: string | null = null;
  for (let turn = 0; turn < 10; turn += 1) {
    const payload: { data?: Array<{ id?: string; name?: string; access_token?: string; link?: string; tasks?: string[] }>; paging?: { cursors?: { after?: string }; next?: string } } = await graphGet(app, "FACEBOOK_PAGES", "me/accounts", { fields: "id,name,access_token,link,tasks", limit: "100", access_token: userToken, ...proof, ...(after ? { after } : {}) });
    for (const page of payload.data ?? []) {
      if (!page.id || !page.access_token) continue;
      pages.push({ id: page.id, name: page.name ?? page.id, token: page.access_token, link: page.link ?? null, canPost: !page.tasks || page.tasks.includes("CREATE_CONTENT") });
    }
    after = payload.paging?.next ? (payload.paging.cursors?.after ?? null) : null;
    if (!after) break;
  }
  return { person: me.name ?? null, pages };
}

export type FacebookTokenHealth = { valid: boolean; expiresAt: string | null; dataAccessExpiresAt: string | null; scopes: string[]; error: string | null };

/** What Facebook says about a token: still valid, when it ends (null: it does not), and what it may do. */
export async function inspectFacebookToken(app: FacebookApp, token: string): Promise<FacebookTokenHealth> {
  const payload = await graphGet<{ data?: { is_valid?: boolean; expires_at?: number; data_access_expires_at?: number; scopes?: string[]; error?: { message?: string } } }>(app, "FACEBOOK_TOKEN_INSPECT", "debug_token", { input_token: token, access_token: `${app.appId}|${app.appSecret}` });
  const stamp = (seconds: number | undefined): string | null => (seconds ? new Date(seconds * 1000).toISOString() : null);
  return { valid: payload.data?.is_valid === true, expiresAt: stamp(payload.data?.expires_at), dataAccessExpiresAt: stamp(payload.data?.data_access_expires_at), scopes: payload.data?.scopes ?? [], error: payload.data?.error?.message ?? null };
}
