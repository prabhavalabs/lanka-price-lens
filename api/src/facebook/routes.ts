import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { dispatchOutbox, exchangeFacebookCode, extendFacebookToken, facebookLoginUrl, facebookText, inspectFacebookToken, listFacebookPages, type ChannelRegistry, type FacebookApp, type OutboxStore } from "@lanka-pricelens/notify";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { envelope, jsonObject, requestOrigin } from "../http.ts";
import type { DealsAccess } from "../newsletters/deals.ts";
import { colomboDay, isDay } from "../newsletters/time.ts";
import { facebookDealsPost, postDeals } from "./post.ts";
import type { FacebookStore } from "./store.ts";

/**
 * The Facebook Page in the admin (docs/facebook.md): connect a Page through Facebook Login,
 * choose the one to post to, pause it, see what was posted, post the day's deals by hand.
 *
 * The admin's session cookie is SameSite=Strict, so it does not come back with Facebook's
 * redirect. `/connect` therefore runs behind the admin session and leaves a signed,
 * short-lived cookie; `/callback` runs outside it and answers only to that cookie with the
 * matching `state`. Whoever reaches the callback without having started from the admin gets
 * nothing.
 */

export const facebookCallbackPath = "/v1/admin/facebook/callback";
export const facebookStateCookie = "lpl_facebook_state";
export const facebookTargetId = "facebook-page";
const stateSeconds = 10 * 60;
const adminPage = "/admin/facebook";

export type FacebookDeps = {
  store: FacebookStore;
  /** LPL_FACEBOOK_APP_ID and LPL_FACEBOOK_APP_SECRET; null until the owner sets them. */
  app: FacebookApp | null;
  outbox: OutboxStore;
  /** The channels "Post now" delivers through; the Facebook one is all it uses. */
  channels: () => ChannelRegistry;
  deals: DealsAccess;
  siteOrigin: string;
  stateSecret: string;
  secureCookies: boolean;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

type ConnectState = { state: string; exp: number };
type Bindings = { Variables: { requestId: string } };
type Ctx = Context<Bindings>;

const stateKey = (secret: string): Buffer => createHmac("sha256", secret).update("facebook-connect").digest();

export function signConnectState(payload: ConnectState, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", stateKey(secret)).update(body).digest("base64url")}`;
}

export function readConnectState(cookie: string | undefined, secret: string, now: Date): ConnectState | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = cookie.slice(0, dot);
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", stateKey(secret)).update(body).digest("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ConnectState> | null;
    if (!parsed || typeof parsed.state !== "string" || typeof parsed.exp !== "number" || parsed.exp * 1000 <= now.getTime()) return null;
    return { state: parsed.state, exp: parsed.exp };
  } catch {
    return null;
  }
}

/** The redirect back from Facebook. Mounted outside the admin session; see the note above. */
export function facebookCallbackRoute(deps: FacebookDeps): (context: Context) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.warn(JSON.stringify(line)));
  return async (context) => {
    const back = (outcome: string) => context.redirect(`${adminPage}?${new URLSearchParams({ facebook: outcome })}`, 302);
    const saved = readConnectState(getCookie(context, facebookStateCookie), deps.stateSecret, now());
    deleteCookie(context, facebookStateCookie, { path: "/" });
    const given = Buffer.from(context.req.query("state") ?? "");
    if (!deps.app) return back("not_configured");
    if (!saved || given.length !== saved.state.length || !timingSafeEqual(given, Buffer.from(saved.state))) {
      log({ level: "warn", message: "Facebook connect refused: state cookie missing, expired, or not matching" });
      return back("expired");
    }
    if (context.req.query("error")) return back("cancelled");
    const code = context.req.query("code");
    if (!code) return back("cancelled");
    try {
      const short = await exchangeFacebookCode(deps.app, code, `${requestOrigin(context)}${facebookCallbackPath}`);
      const found = await listFacebookPages(deps.app, await extendFacebookToken(deps.app, short));
      if (!found.pages.length) return back("no_pages");
      deps.store.connect(found.pages, found.person, now());
      log({ level: "info", message: "Facebook Pages connected", pages: found.pages.length });
      return back(found.pages.some((page) => page.canPost) ? "connected" : "no_rights");
    } catch (error) {
      log({ level: "error", message: "Facebook connect failed", detail: error instanceof Error ? error.message : String(error) });
      return back("failed");
    }
  };
}

export function facebookAdminRoutes(deps: FacebookDeps): Hono<Bindings> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.warn(JSON.stringify(line)));
  const app = new Hono<Bindings>();
  const ok = (context: Ctx, payload: unknown, message = "OK") => context.json(envelope(context.get("requestId") ?? "unknown", payload, true, message));
  const refuse = (context: Ctx, status: 400 | 404 | 409 | 502 | 503, message: string) => context.json(envelope(context.get("requestId") ?? "unknown", null, false, message), status);

  /** The day's post as it would go out: the caption and where its picture is served. */
  const preview = async (day: string) => {
    const dealsDay = deps.deals.read(day) ?? (await deps.deals.compute(day)) ?? deps.deals.latest();
    if (!dealsDay) return null;
    const post = facebookDealsPost(dealsDay, deps.siteOrigin);
    return { day: dealsDay.day, requested_day: day, ready: post !== null, caption: post ? facebookText(post) : null, image_url: post?.image?.url ?? null, rows: postDeals(dealsDay), post };
  };

  const status = (context: Ctx) => ({
    configured: deps.app !== null,
    app_id: deps.app?.appId ?? null,
    redirect_uri: `${requestOrigin(context)}${facebookCallbackPath}`,
    pages: deps.store.list(),
    posts: deps.store.posts(30),
  });

  app.get("/", (context) => ok(context, status(context)));

  app.get("/connect", (context) => {
    if (!deps.app) return context.redirect(`${adminPage}?facebook=not_configured`, 302);
    const state = randomBytes(24).toString("base64url");
    const exp = Math.floor(now().getTime() / 1000) + stateSeconds;
    setCookie(context, facebookStateCookie, signConnectState({ state, exp }, deps.stateSecret), { httpOnly: true, sameSite: "Lax", secure: deps.secureCookies, path: "/", maxAge: stateSeconds });
    return context.redirect(facebookLoginUrl({ appId: deps.app.appId, redirectUri: `${requestOrigin(context)}${facebookCallbackPath}`, state, version: deps.app.version }), 302);
  });

  app.get("/preview", async (context) => {
    const day = context.req.query("day") ?? colomboDay(now());
    if (!isDay(day)) return refuse(context, 400, "Not a day");
    const found = await preview(day);
    if (!found) return refuse(context, 503, "No deals to preview: the warehouse did not answer and no day is saved");
    const { post: _post, ...rest } = found;
    return ok(context, rest);
  });

  app.post("/pages/:pageId/activate", (context) => (deps.store.activate(context.req.param("pageId"), now()) ? ok(context, status(context), "This Page is the one posted to") : refuse(context, 404, "Page not found")));

  app.post("/pages/:pageId/pause", bodyLimit({ maxSize: 1024 }), async (context) => {
    const body = await jsonObject(context);
    if (!body || typeof body.paused !== "boolean") return refuse(context, 400, "paused must be true or false");
    return deps.store.setPaused(context.req.param("pageId"), body.paused, now()) ? ok(context, status(context), body.paused ? "Posting paused" : "Posting resumed") : refuse(context, 404, "Page not found");
  });

  app.delete("/pages/:pageId", (context) => (deps.store.disconnect(context.req.param("pageId")) ? ok(context, status(context), "Page disconnected") : refuse(context, 404, "Page not found")));

  /** Asks Facebook whether the active Page's token still stands, and records the answer. */
  app.post("/check", async (context) => {
    const page = deps.store.active();
    if (!deps.app || !page) return refuse(context, 409, "Connect a Page first");
    const token = deps.store.tokenFor(page.page_id);
    if (!token) {
      deps.store.markToken(page.page_id, { valid: false, error: page.token_error ?? "The stored token cannot be read; connect the Page again" }, now());
      return ok(context, status(context), "The Page needs connecting again");
    }
    try {
      const health = await inspectFacebookToken(deps.app, token);
      deps.store.markToken(page.page_id, { valid: health.valid, error: health.error, expiresAt: health.expiresAt }, now());
      return ok(context, { ...status(context), health: { valid: health.valid, expires_at: health.expiresAt, data_access_expires_at: health.dataAccessExpiresAt, scopes: health.scopes } }, health.valid ? "Facebook accepts the token" : "Facebook no longer accepts the token");
    } catch (error) {
      log({ level: "error", message: "Facebook token check failed", detail: error instanceof Error ? error.message : String(error) });
      return refuse(context, 502, "Facebook did not answer the check");
    }
  });

  /** Posts the day's deals now, once more even when the day already has its post. */
  app.post("/post", bodyLimit({ maxSize: 1024 }), async (context) => {
    const body = await jsonObject(context);
    const day = typeof body?.day === "string" ? body.day : colomboDay(now());
    if (!isDay(day)) return refuse(context, 400, "Not a day");
    const page = deps.store.active();
    if (!page) return refuse(context, 409, "Connect a Page first");
    if (page.token_status !== "ok") return refuse(context, 409, "The Page needs connecting again");
    const found = await preview(day);
    if (!found?.post) return refuse(context, 409, "The day has too few deals for a post");
    const stamp = now();
    const dedupeKey = `facebook:manual:${found.day}:${stamp.toISOString()}`;
    deps.outbox.enqueue([{ targetId: facebookTargetId, target: { kind: "facebook", address: page.page_id }, message: { ...found.post, dedupe_key: dedupeKey }, dedupeKey }], stamp);
    const report = await dispatchOutbox(deps.outbox, deps.channels(), { now, only: "facebook", onGone: (entry, error) => deps.store.markToken(entry.target.address, { valid: false, error }, now()) });
    const post = deps.store.posts(10).find((entry) => entry.dedupe_key === dedupeKey);
    if (post?.status === "sent") return ok(context, { ...status(context), report, post }, "Posted to the Page");
    // A post made by hand is not tried again behind the owner's back an hour later: it went now or it did not go.
    if (post && post.status !== "dead") deps.outbox.markDead(post.id, post.error ?? "FACEBOOK_NOT_POSTED: given up, posted by hand", now());
    return context.json(envelope(context.get("requestId") ?? "unknown", { ...status(context), report, post: post ?? null }, false, `Not posted: ${post?.error ?? "queued for another try"}`), 502);
  });

  return app;
}
