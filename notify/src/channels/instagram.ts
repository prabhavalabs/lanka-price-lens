import { bodyExcerpt, classifyStatus, failure, mask, type Channel, type Delivery, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { facebookProof, type FacebookApp } from "./facebook.ts";
import { instagramCaptionLimit, instagramText } from "../render/instagram.ts";

/**
 * Instagram professional accounts through the Instagram Platform API, which is reached over the
 * same Graph API host and with the same Page token as the Facebook Page the account is linked to.
 *
 * Publishing takes two calls, and a carousel takes one per picture: a container is created for
 * each picture, a container for the set, and only then is the set published. A container that is
 * made but never published costs nothing; Instagram drops it after a day. So when anything fails
 * before the publishing call, the whole post is simply tried again later.
 *
 * Instagram will not take a post without a picture, and fetches every picture itself from the
 * address given, which therefore has to be reachable from the open internet and be a JPEG.
 */

export const instagramGraphVersion = "v25.0";
/** What connecting asks for on top of the Page scopes: reading the linked account, and publishing to it. */
export const instagramScopes = ["instagram_basic", "instagram_content_publish"] as const;
/** Instagram takes at most ten pictures in one carousel. */
export const instagramCarouselLimit = 10;

export type InstagramConfig = {
  /** The token that publishes for this account: the one of the Page it is linked to. Null when it is not connected (any more). */
  accountToken: (accountId: string) => string | null | Promise<string | null>;
  appSecret?: string | undefined;
  fetch?: FetchLike | undefined;
  apiBase?: string | undefined;
  version?: string | undefined;
  /** How long to wait for a container to finish, in milliseconds; only a carousel usually needs any wait. */
  readyTimeoutMs?: number | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
};

type GraphError = { message?: string; type?: string; code?: number; error_subcode?: number };
type GraphResult = { id?: string; status_code?: string; permalink?: string; error?: GraphError };

/** The token is dead or the account no longer grants us publishing: only connecting again helps. */
const goneCodes = new Set([10, 102, 190]);
/** Instagram's own "try again later": a passing fault, or one of its rate limits. */
const retryCodes = new Set([1, 2, 4, 17, 32, 341, 613, 80001]);
/** The container is not finished yet, or Instagram could not fetch the picture in time. */
const notReadyCodes = new Set([9007, 2207027, 2207032, 2207050, 2207051]);
/** The account has used up its posts for the day. */
const publishLimitCodes = new Set([25, 2207042]);
const rateLimitWaitMs = 3_600_000;
const publishLimitWaitMs = 6 * 3_600_000;

const graphBase = (config: { apiBase?: string | undefined; version?: string | undefined }): string => `${config.apiBase ?? "https://graph.facebook.com"}/${config.version ?? instagramGraphVersion}`;

export function classifyInstagramError(error: GraphError | undefined, status: number, headers?: Headers): { retryable: boolean; gone: boolean; retryAfterMs: number | undefined } {
  const code = error?.code;
  const subcode = error?.error_subcode;
  if (code !== undefined) {
    if (goneCodes.has(code)) return { retryable: false, gone: true, retryAfterMs: undefined };
    if (publishLimitCodes.has(code) || (subcode !== undefined && publishLimitCodes.has(subcode))) return { retryable: true, gone: false, retryAfterMs: publishLimitWaitMs };
    if (notReadyCodes.has(code) || (subcode !== undefined && notReadyCodes.has(subcode))) return { retryable: true, gone: false, retryAfterMs: undefined };
    if (retryCodes.has(code)) return { retryable: true, gone: false, retryAfterMs: code === 1 || code === 2 ? undefined : rateLimitWaitMs };
    // A picture Instagram will not take, a caption it refuses, a wrong parameter: the same call fails again.
    return { retryable: false, gone: false, retryAfterMs: undefined };
  }
  const classified = classifyStatus(status, headers);
  return { ...classified, gone: false };
}

/** The pictures of a message, in order: the set when there is one, otherwise the single picture. */
export function instagramPictures(message: Message): string[] {
  const pictures = message.images?.length ? message.images : message.image ? [message.image] : [];
  return pictures.slice(0, instagramCarouselLimit).map((picture) => picture.url);
}

export function createInstagramChannel(config: InstagramConfig): Channel {
  const request = config.fetch ?? fetch;
  const base = graphBase(config);
  const wait = config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const readyTimeoutMs = config.readyTimeoutMs ?? 20_000;

  /** One Graph call. The token travels in the body, never in the address, so it stays out of any log of requests. */
  const post = async (path: string, token: string, fields: Record<string, string>): Promise<{ ok: true; id: string } | { ok: false; delivery: Delivery }> => {
    const body = new URLSearchParams({ ...fields, access_token: token, ...(config.appSecret ? { appsecret_proof: facebookProof(token, config.appSecret) } : {}) });
    let response: Response;
    try {
      response = await request(`${base}/${path}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString(), signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      return { ok: false, delivery: failure(`INSTAGRAM_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true }) };
    }
    const payload = (await response.clone().json().catch(() => null)) as GraphResult | null;
    if (response.ok && payload?.id && !payload.error) return { ok: true, id: payload.id };
    const detail = payload?.error?.message ?? (await bodyExcerpt(response));
    const code = payload?.error?.code;
    const label = code === undefined ? `INSTAGRAM_HTTP_${response.status}` : `INSTAGRAM_${code}${payload?.error?.error_subcode ? `_${payload.error.error_subcode}` : ""}`;
    return { ok: false, delivery: failure(`${label}: ${detail}`.slice(0, 500), classifyInstagramError(payload?.error, response.status, response.headers)) };
  };

  const read = async (path: string, token: string, fields: string): Promise<GraphResult | null> => {
    const query = new URLSearchParams({ fields, access_token: token, ...(config.appSecret ? { appsecret_proof: facebookProof(token, config.appSecret) } : {}) });
    try {
      const response = await request(`${base}/${path}?${query}`, { signal: AbortSignal.timeout(20_000) });
      return (await response.json().catch(() => null)) as GraphResult | null;
    } catch {
      return null;
    }
  };

  /**
   * Waits until a container is ready to publish. A container for one picture is almost always
   * ready at once; the set's container is the one that takes a moment. Giving up here is not an
   * error: the publishing call is made anyway, and its own answer decides.
   */
  const settle = async (containerId: string, token: string): Promise<void> => {
    const deadline = Date.now() + readyTimeoutMs;
    for (let turn = 0; Date.now() < deadline; turn += 1) {
      const status = (await read(containerId, token, "status_code"))?.status_code;
      if (status === "FINISHED" || status === "PUBLISHED" || status === "ERROR" || status === "EXPIRED" || !status) return;
      await wait(Math.min(2000, 500 * 2 ** turn));
    }
  };

  return {
    kind: "instagram",
    describe: (target) => `instagram:${mask(target.address, 3)}`,
    send: async (target: Target, message: Message) => {
      if (!/^\d{5,32}$/u.test(target.address)) return failure("INSTAGRAM_ACCOUNT_INVALID: an account id is digits only");
      const token = await config.accountToken(target.address);
      if (!token) return failure("INSTAGRAM_NOT_CONNECTED: no access token for this account", { gone: true });
      const pictures = instagramPictures(message);
      // Instagram has no text-only post; without a picture there is nothing it would accept.
      if (!pictures.length) return failure("INSTAGRAM_NO_PICTURE: Instagram takes no post without a picture");
      const caption = instagramText(message, instagramCaptionLimit);

      let containerId: string;
      if (pictures.length === 1) {
        const created = await post(`${target.address}/media`, token, { image_url: pictures[0] as string, caption });
        if (!created.ok) return created.delivery;
        containerId = created.id;
      } else {
        const children: string[] = [];
        for (const url of pictures) {
          const child = await post(`${target.address}/media`, token, { image_url: url, is_carousel_item: "true" });
          if (!child.ok) return child.delivery;
          children.push(child.id);
        }
        const parent = await post(`${target.address}/media`, token, { media_type: "CAROUSEL", children: children.join(","), caption });
        if (!parent.ok) return parent.delivery;
        containerId = parent.id;
      }

      await settle(containerId, token);
      const published = await post(`${target.address}/media_publish`, token, { creation_id: containerId });
      if (!published.ok) return published.delivery;
      // The address of the post is only known once it exists; when Instagram does not give it, the id stands in.
      const permalink = (await read(published.id, token, "permalink"))?.permalink;
      return { ok: true, reference: permalink ?? published.id };
    },
  };
}

/** Where the post can be opened, when Instagram gave its address; an id on its own does not make one. */
export function instagramPostUrl(reference: string): string | null {
  return /^https?:\/\//u.test(reference) ? reference : null;
}

// --- Connecting: the accounts reached through the Pages the person shared ---------------------

export type InstagramAccount = {
  id: string;
  username: string;
  name: string;
  picture: string | null;
  /** The Page the account is linked to, whose token publishes for it. */
  pageId: string;
  pageName: string;
  token: string;
  canPost: boolean;
};

type PageWithInstagram = { id: string; name: string; token: string; canPost: boolean };
type LinkedAccount = { instagram_business_account?: { id?: string; username?: string; name?: string; profile_picture_url?: string }; error?: GraphError };

/**
 * The Instagram accounts behind the Pages the person shared. An account appears only when it is a
 * professional one linked to a Page, which is the only kind the API can publish to.
 */
export async function listInstagramAccounts(app: FacebookApp, pages: readonly PageWithInstagram[]): Promise<InstagramAccount[]> {
  const request = app.fetch ?? fetch;
  const base = graphBase(app);
  const accounts: InstagramAccount[] = [];
  for (const page of pages) {
    const query = new URLSearchParams({ fields: "instagram_business_account{id,username,name,profile_picture_url}", access_token: page.token, appsecret_proof: facebookProof(page.token, app.appSecret) });
    let payload: LinkedAccount | null = null;
    try {
      const response = await request(`${base}/${page.id}?${query}`, { signal: AbortSignal.timeout(20_000) });
      payload = (await response.json().catch(() => null)) as LinkedAccount | null;
    } catch {
      continue;
    }
    const found = payload?.instagram_business_account;
    if (!found?.id) continue;
    accounts.push({
      id: found.id,
      username: found.username ?? found.id,
      name: found.name ?? found.username ?? found.id,
      picture: found.profile_picture_url ?? null,
      pageId: page.id,
      pageName: page.name,
      token: page.token,
      canPost: page.canPost,
    });
  }
  return accounts;
}

export type InstagramPublishingLimit = { used: number; cap: number };

/** How many of the day's posts the account has used. Instagram refuses the rest until the day rolls on. */
export async function instagramPublishingLimit(app: Pick<FacebookApp, "fetch" | "apiBase" | "version" | "appSecret">, accountId: string, token: string): Promise<InstagramPublishingLimit | null> {
  const request = app.fetch ?? fetch;
  const query = new URLSearchParams({ fields: "config,quota_usage", access_token: token, appsecret_proof: facebookProof(token, app.appSecret) });
  try {
    const response = await request(`${graphBase(app)}/${accountId}/content_publishing_limit?${query}`, { signal: AbortSignal.timeout(20_000) });
    const payload = (await response.json().catch(() => null)) as { data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> } | null;
    const row = payload?.data?.[0];
    if (!row) return null;
    return { used: row.quota_usage ?? 0, cap: row.config?.quota_total ?? 100 };
  } catch {
    return null;
  }
}
