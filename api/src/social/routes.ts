import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import {
  dispatchOutbox,
  exchangeFacebookCode,
  extendFacebookToken,
  facebookLoginUrl,
  facebookScopes,
  facebookText,
  instagramPublishingLimit,
  instagramScopes,
  instagramText,
  listFacebookPages,
  listInstagramAccounts,
  type ChannelRegistry,
  type FacebookApp,
  type OutboxStore,
} from "@lanka-pricelens/notify";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { envelope, jsonObject, requestOrigin } from "../http.ts";
import type { DealsAccess } from "../newsletters/deals.ts";
import { colomboDay, isDay } from "../newsletters/time.ts";
import { isPlatform, type Platform, type SocialStore } from "./accounts.ts";
import { isClock, isSettingChannel, postingZone, settingChannels, type SettingsStore } from "./settings.ts";
import { runChannelJob, type JobRunners } from "./jobs.ts";
import { isCron } from "./recurrence.ts";
import { carouselMax, contentStatuses, uploadMaxBytes, type ContentStatus, type LibraryStore } from "./library.ts";
import { facebookDealsPost, postDeals } from "./post.ts";
import { contentMessage, publishBlocker, publishSchedule, runDueSchedules, type PublishDeps } from "./publish.ts";

/**
 * Distribution channels in the admin (docs/distribution.md): connect a Facebook Page and the
 * Instagram account linked to it, keep a library of posts, and put them out on a plan.
 *
 * The admin's session cookie is SameSite=Strict, so it does not come back with Facebook's
 * redirect. `/connect` therefore runs behind the admin session and leaves a signed, short-lived
 * cookie; the callback runs outside it and answers only to that cookie with the matching `state`.
 * Whoever reaches the callback without having started from the admin gets nothing.
 *
 * The callback address is the one already registered in the Meta app, so it keeps its old path
 * even though everything else moved under /distribution. Changing it would mean editing the Meta
 * app again, for nothing.
 */

export const facebookCallbackPath = "/v1/admin/facebook/callback";
export const facebookStateCookie = "lpl_facebook_state";
export const facebookTargetId = "facebook-page";
const stateSeconds = 10 * 60;
const adminPage = "/admin/distribution/facebook";
/** Connecting asks for both platforms at once: the Instagram account is reached through its Page. */
const connectScopes = [...facebookScopes, ...instagramScopes];

export type DistributionDeps = {
  accounts: SocialStore;
  content: LibraryStore;
  settings: SettingsStore;
  /** LPL_FACEBOOK_APP_ID and LPL_FACEBOOK_APP_SECRET; null until the owner sets them. */
  app: FacebookApp | null;
  outbox: OutboxStore;
  channels: () => ChannelRegistry;
  deals: DealsAccess;
  /** What a channel's job does when the admin presses Run now; absent in tests that do not run jobs. */
  runners?: (() => JobRunners) | undefined;
  siteOrigin: string;
  stateSecret: string;
  secureCookies: boolean;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

type ConnectState = { state: string; exp: number };
type Bindings = { Variables: { requestId: string; adminUser?: { email: string } } };
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
export function facebookCallbackRoute(deps: DistributionDeps): (context: Context) => Promise<Response> {
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
      // The Instagram accounts come from the Pages, each with the token of the Page it hangs off.
      const instagram = await listInstagramAccounts(deps.app, found.pages.map((page) => ({ id: page.id, name: page.name, token: page.token, canPost: page.canPost })));
      deps.accounts.connect({ pages: found.pages, instagram }, found.person, now());
      log({ level: "info", message: "Accounts connected", pages: found.pages.length, instagram: instagram.length });
      return back(found.pages.some((page) => page.canPost) ? (instagram.length ? "connected" : "connected_no_instagram") : "no_rights");
    } catch (error) {
      log({ level: "error", message: "Facebook connect failed", detail: error instanceof Error ? error.message : String(error) });
      return back("failed");
    }
  };
}

export function distributionAdminRoutes(deps: DistributionDeps): Hono<Bindings> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: Record<string, unknown>) => console.warn(JSON.stringify(line)));
  const app = new Hono<Bindings>();
  const ok = (context: Ctx, payload: unknown, message = "OK") => context.json(envelope(context.get("requestId") ?? "unknown", payload, true, message));
  const refuse = (context: Ctx, status: 400 | 404 | 409 | 413 | 502 | 503, message: string) => context.json(envelope(context.get("requestId") ?? "unknown", null, false, message), status);
  const who = (context: Ctx): string | null => context.get("adminUser")?.email ?? null;
  const publishDeps = (): PublishDeps => ({ accounts: deps.accounts, content: deps.content, outbox: deps.outbox, channels: deps.channels, now, log });

  const platformOf = (context: Ctx): Platform | null => {
    const given = context.req.param("platform");
    return isPlatform(given) ? given : null;
  };

  const status = (context: Ctx) => ({
    configured: deps.app !== null,
    app_id: deps.app?.appId ?? null,
    redirect_uri: `${requestOrigin(context)}${facebookCallbackPath}`,
    accounts: deps.accounts.list(),
    posts: deps.accounts.posts(30),
  });

  app.get("/", (context) => ok(context, { ...status(context), zone: postingZone, settings: deps.settings.all() }));

  /**
   * One post as its platform will show it: the caption rendered the way that channel renders it,
   * the account it goes out as, and its picture. The picture is also offered on this server's own
   * address, so a post can be looked at against the code running here rather than against the
   * card production happens to be serving.
   */
  app.get("/posts/:id", (context) => {
    const found = deps.accounts.readPost(context.req.param("id"));
    if (!found) return refuse(context, 404, "No such post");
    const account = deps.accounts.list(found.post.platform).find((entry) => entry.account_id === found.post.account_id);
    const image = found.message.image?.url ?? null;
    // A path rather than an address: the admin reads it from whichever origin is serving it, which
    // is this server in production and the development server's proxy while working on it.
    const path = image?.match(/^https?:\/\/[^/]+(\/.*)$/u)?.[1] ?? null;
    return ok(context, {
      post: found.post,
      text: found.post.platform === "instagram" ? instagramText(found.message) : facebookText(found.message),
      image_url: image,
      preview_image_path: path,
      image_alt: found.message.image?.alt ?? null,
      account: account ? { name: account.name, username: account.username, picture: account.picture, link: account.link } : null,
    });
  });

  // --- What each channel does and when -----------------------------------------------------------

  app.get("/settings", (context) => ok(context, { zone: postingZone, channels: settingChannels, settings: deps.settings.all(), jobs: deps.settings.jobs() }));

  app.put("/settings/:channel", bodyLimit({ maxSize: 1024 }), async (context) => {
    const channel = context.req.param("channel");
    if (!isSettingChannel(channel)) return refuse(context, 404, "No such channel");
    const body = await jsonObject(context);
    if (body?.send_at !== undefined && !isClock(body.send_at)) return refuse(context, 400, "A send time reads as 07:30, on the 24-hour clock");
    if (body?.enabled !== undefined && typeof body.enabled !== "boolean") return refuse(context, 400, "enabled must be true or false");
    const saved = deps.settings.save(
      channel,
      { ...(typeof body?.enabled === "boolean" ? { enabled: body.enabled } : {}), ...(isClock(body?.send_at) ? { send_at: body.send_at } : {}) },
      who(context),
      now(),
    );
    return ok(context, { zone: postingZone, settings: deps.settings.all(), jobs: deps.settings.jobs(), saved }, `${channel} saved`);
  });

  /** One job of one channel: whether it runs at all, and the expression that says when. */
  app.put("/settings/:channel/jobs/:job", bodyLimit({ maxSize: 1024 }), async (context) => {
    const channel = context.req.param("channel");
    if (!isSettingChannel(channel)) return refuse(context, 404, "No such channel");
    const body = await jsonObject(context);
    if (body?.enabled !== undefined && typeof body.enabled !== "boolean") return refuse(context, 400, "enabled must be true or false");
    if (body?.cron !== undefined && !isCron(body.cron)) {
      return refuse(context, 400, "A recurrence reads as five cron fields in Colombo time, such as \"30 7 * * *\" for every day at 07:30");
    }
    const saved = deps.settings.saveJob(
      channel,
      context.req.param("job"),
      { ...(typeof body?.enabled === "boolean" ? { enabled: body.enabled } : {}), ...(isCron(body?.cron) ? { cron: body.cron } : {}) },
      who(context),
      now(),
    );
    if (!saved) return refuse(context, 404, "No such job on this channel");
    return ok(context, { zone: postingZone, settings: deps.settings.all(), jobs: deps.settings.jobs(), saved }, `${saved.label} saved`);
  });

  /**
   * Runs one job now, whatever its recurrence says. Safe to press twice: a mail run is guarded by
   * the newsletter's own record of the day and a post by the outbox's dedupe key, so a second
   * press reports that the day already has its post rather than sending another.
   */
  app.post("/settings/:channel/jobs/:job/run", async (context) => {
    const channel = context.req.param("channel");
    if (!isSettingChannel(channel)) return refuse(context, 404, "No such channel");
    const job = context.req.param("job");
    const schedule = deps.settings.job(channel, job);
    if (!schedule) return refuse(context, 404, "No such job on this channel");
    if (!deps.runners) return refuse(context, 503, "This server does not run the channels' jobs");
    const at = now();
    const outcome = await runChannelJob(channel, job, { ...deps.runners(), now }, colomboDay(at));
    deps.settings.markJobRun(channel, job, { status: outcome.status, error: outcome.status === "ran" ? null : outcome.detail }, at);
    log({ level: outcome.status === "failed" ? "error" : "info", message: "Channel job run by hand", channel, job, status: outcome.status, detail: outcome.detail });
    const payload = { zone: postingZone, settings: deps.settings.all(), jobs: deps.settings.jobs(), outcome };
    if (outcome.status === "failed") return context.json(envelope(context.get("requestId") ?? "unknown", payload, false, outcome.detail), 502);
    return ok(context, payload, outcome.detail);
  });

  app.get("/connect", (context) => {
    if (!deps.app) return context.redirect(`${adminPage}?facebook=not_configured`, 302);
    const state = randomBytes(24).toString("base64url");
    const exp = Math.floor(now().getTime() / 1000) + stateSeconds;
    setCookie(context, facebookStateCookie, signConnectState({ state, exp }, deps.stateSecret), { httpOnly: true, sameSite: "Lax", secure: deps.secureCookies, path: "/", maxAge: stateSeconds });
    return context.redirect(facebookLoginUrl({ appId: deps.app.appId, redirectUri: `${requestOrigin(context)}${facebookCallbackPath}`, state, scopes: connectScopes, version: deps.app.version }), 302);
  });

  // --- The connected accounts -----------------------------------------------------------------

  app.post("/accounts/:platform/:accountId/activate", (context) => {
    const platform = platformOf(context);
    if (!platform) return refuse(context, 404, "No such platform");
    return deps.accounts.activate(platform, context.req.param("accountId"), now()) ? ok(context, status(context), "This account is the one posted to") : refuse(context, 404, "Account not found");
  });

  app.post("/accounts/:platform/:accountId/pause", bodyLimit({ maxSize: 1024 }), async (context) => {
    const platform = platformOf(context);
    if (!platform) return refuse(context, 404, "No such platform");
    const body = await jsonObject(context);
    if (!body || typeof body.paused !== "boolean") return refuse(context, 400, "paused must be true or false");
    return deps.accounts.setPaused(platform, context.req.param("accountId"), body.paused, now()) ? ok(context, status(context), body.paused ? "Posting paused" : "Posting resumed") : refuse(context, 404, "Account not found");
  });

  app.delete("/accounts/:platform/:accountId", (context) => {
    const platform = platformOf(context);
    if (!platform) return refuse(context, 404, "No such platform");
    return deps.accounts.disconnect(platform, context.req.param("accountId")) ? ok(context, status(context), "Account disconnected") : refuse(context, 404, "Account not found");
  });

  /** Asks the platform whether the active account's token still stands, and records the answer. */
  app.post("/accounts/:platform/check", async (context) => {
    const platform = platformOf(context);
    if (!platform) return refuse(context, 404, "No such platform");
    const account = deps.accounts.active(platform);
    if (!deps.app || !account) return refuse(context, 409, "Connect an account first");
    const token = deps.accounts.tokenFor(platform, account.account_id);
    if (!token) {
      deps.accounts.markToken(platform, account.account_id, { valid: false, error: account.token_error ?? "The stored token cannot be read; connect the account again" }, now());
      return ok(context, status(context), "The account needs connecting again");
    }
    try {
      const { inspectFacebookToken } = await import("@lanka-pricelens/notify");
      const health = await inspectFacebookToken(deps.app, token);
      deps.accounts.markToken(platform, account.account_id, { valid: health.valid, error: health.error, expiresAt: health.expiresAt }, now());
      // Instagram counts the day's posts against a cap of its own, which is worth showing beside the token.
      const limit = platform === "instagram" && health.valid ? await instagramPublishingLimit({ ...deps.app }, account.account_id, token) : null;
      return ok(context, { ...status(context), health: { valid: health.valid, expires_at: health.expiresAt, data_access_expires_at: health.dataAccessExpiresAt, scopes: health.scopes }, publishing_limit: limit }, health.valid ? "The token is accepted" : "The token is no longer accepted");
    } catch (error) {
      log({ level: "error", message: "Token check failed", platform, detail: error instanceof Error ? error.message : String(error) });
      return refuse(context, 502, "The platform did not answer the check");
    }
  });

  // --- The day's deals post, which PriceLens draws itself ---------------------------------------

  /** The day's post as it would go out: the caption and where its picture is served. */
  const dealsPreview = async (day: string, platform: Platform) => {
    const dealsDay = deps.deals.read(day) ?? (await deps.deals.compute(day)) ?? deps.deals.latest();
    if (!dealsDay) return null;
    const post = facebookDealsPost(dealsDay, deps.siteOrigin);
    return { day: dealsDay.day, requested_day: day, ready: post !== null, caption: post ? (platform === "instagram" ? instagramText(post) : facebookText(post)) : null, image_url: post?.image?.url ?? null, rows: postDeals(dealsDay), post };
  };

  app.get("/deals/preview", async (context) => {
    const day = context.req.query("day") ?? colomboDay(now());
    const platform = isPlatform(context.req.query("platform")) ? (context.req.query("platform") as Platform) : "facebook";
    if (!isDay(day)) return refuse(context, 400, "Not a day");
    const found = await dealsPreview(day, platform);
    if (!found) return refuse(context, 503, "No deals to preview: the warehouse did not answer and no day is saved");
    const { post: _post, ...rest } = found;
    return ok(context, { ...rest, platform });
  });

  /** Posts the day's deals now, once more even when the day already has its post. */
  app.post("/deals/post", bodyLimit({ maxSize: 1024 }), async (context) => {
    const body = await jsonObject(context);
    const day = typeof body?.day === "string" ? body.day : colomboDay(now());
    const platform = isPlatform(body?.platform) ? body.platform : "facebook";
    if (!isDay(day)) return refuse(context, 400, "Not a day");
    const account = deps.accounts.active(platform);
    if (!account) return refuse(context, 409, "Connect an account first");
    if (account.token_status !== "ok") return refuse(context, 409, "The account needs connecting again");
    const found = await dealsPreview(day, platform);
    if (!found?.post) return refuse(context, 409, "The day has too few deals for a post");
    if (platform === "instagram" && !found.post.image) return refuse(context, 409, "Instagram takes no post without a picture");
    const stamp = now();
    const dedupeKey = `${platform}:manual:${found.day}:${stamp.toISOString()}`;
    deps.outbox.enqueue([{ targetId: facebookTargetId, target: { kind: platform, address: account.account_id }, message: { ...found.post, dedupe_key: dedupeKey }, dedupeKey }], stamp);
    const report = await dispatchOutbox(deps.outbox, deps.channels(), { now, only: platform, onGone: (entry, error) => deps.accounts.markToken(platform, entry.target.address, { valid: false, error }, now()) });
    const post = deps.accounts.posts(10, platform).find((entry) => entry.dedupe_key === dedupeKey);
    if (post?.status === "sent") return ok(context, { ...status(context), report, post }, "Posted");
    // A post made by hand is not tried again behind the owner's back an hour later.
    if (post && post.status !== "dead") deps.outbox.markDead(post.id, post.error ?? "NOT_POSTED: given up, posted by hand", now());
    return context.json(envelope(context.get("requestId") ?? "unknown", { ...status(context), report, post: post ?? null }, false, `Not posted: ${post?.error ?? "queued for another try"}`), 502);
  });

  // --- The library -----------------------------------------------------------------------------

  const itemBody = async (context: Ctx): Promise<{ title: string; caption: string; link: string | null; status?: ContentStatus; tags: string[] } | string> => {
    const body = await jsonObject(context);
    if (!body) return "Send a post";
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const caption = typeof body.caption === "string" ? body.caption.trim() : "";
    if (!title) return "A post needs a name";
    if (caption.length > 4000) return "That caption is too long";
    const link = typeof body.link === "string" && body.link.trim() ? body.link.trim() : null;
    if (link && !/^https:\/\//u.test(link)) return "A link has to start with https://";
    const state = typeof body.status === "string" && (contentStatuses as readonly string[]).includes(body.status) ? (body.status as ContentStatus) : undefined;
    const tags = Array.isArray(body.tags) ? body.tags.filter((tag): tag is string => typeof tag === "string") : [];
    return { title, caption, link, ...(state ? { status: state } : {}), tags };
  };

  app.get("/library", (context) => {
    const query = context.req.query();
    const state = query.status && (contentStatuses as readonly string[]).includes(query.status) ? (query.status as ContentStatus) : undefined;
    const found = deps.content.list({ ...(state ? { status: state } : {}), ...(query.search ? { search: query.search.slice(0, 100) } : {}), limit: Number(query.limit ?? 50), offset: Number(query.offset ?? 0) });
    return ok(context, { ...found, carousel_max: carouselMax });
  });

  app.get("/library/:id", (context) => {
    const item = deps.content.read(context.req.param("id"));
    return item ? ok(context, item) : refuse(context, 404, "No such post");
  });

  app.post("/library", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const input = await itemBody(context);
    if (typeof input === "string") return refuse(context, 400, input);
    return ok(context, deps.content.create(input, who(context), now()), "Post saved");
  });

  app.put("/library/:id", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const input = await itemBody(context);
    if (typeof input === "string") return refuse(context, 400, input);
    const item = deps.content.update(context.req.param("id"), input, now());
    return item ? ok(context, item, "Post saved") : refuse(context, 404, "No such post");
  });

  app.delete("/library/:id", async (context) => ((await deps.content.remove(context.req.param("id"))) ? ok(context, null, "Post deleted") : refuse(context, 404, "No such post")));

  /** One picture, as the file itself. It is re-encoded to a JPEG the platforms accept before it is kept. */
  app.post("/library/:id/assets", bodyLimit({ maxSize: uploadMaxBytes, onError: (context) => context.json(envelope("unknown", null, false, "That picture is too large"), 413) }), async (context) => {
    const body = await context.req.arrayBuffer();
    if (!body.byteLength) return refuse(context, 400, "Send the picture as the body of the request");
    const added = await deps.content.addAsset(context.req.param("id"), new Uint8Array(body), now());
    if ("error" in added) return refuse(context, 400, added.error);
    const item = deps.content.read(context.req.param("id"));
    return ok(context, item, "Picture added");
  });

  app.delete("/library/:id/assets/:assetId", async (context) => {
    const gone = await deps.content.removeAsset(context.req.param("id"), context.req.param("assetId"));
    return gone ? ok(context, deps.content.read(context.req.param("id")), "Picture removed") : refuse(context, 404, "No such picture");
  });

  /** The post as each platform would show it, so the owner reads it before it goes anywhere. */
  app.get("/library/:id/preview", (context) => {
    const item = deps.content.read(context.req.param("id"));
    if (!item) return refuse(context, 404, "No such post");
    const rendered = contentMessage(item, "preview");
    return ok(context, {
      facebook: { caption: facebookText(rendered), blocker: publishBlocker(deps.accounts, "facebook", item) },
      instagram: { caption: instagramText(rendered), blocker: publishBlocker(deps.accounts, "instagram", item) },
      pictures: item.assets.map((asset) => asset.url),
    });
  });

  // --- The calendar ----------------------------------------------------------------------------

  app.post("/library/:id/schedule", bodyLimit({ maxSize: 1024 }), async (context) => {
    const body = await jsonObject(context);
    const platform = isPlatform(body?.platform) ? body.platform : null;
    if (!platform) return refuse(context, 400, "Say which platform");
    const when = typeof body?.scheduled_for === "string" ? new Date(body.scheduled_for) : null;
    if (!when || Number.isNaN(when.getTime())) return refuse(context, 400, "Say when the post goes out");
    const row = deps.content.schedule(context.req.param("id"), platform, when, who(context), now());
    return row ? ok(context, deps.content.read(context.req.param("id")), "Scheduled") : refuse(context, 404, "No such post");
  });

  app.delete("/schedules/:scheduleId", (context) => (deps.content.cancelSchedule(context.req.param("scheduleId"), now()) ? ok(context, null, "Called off") : refuse(context, 409, "That post has already gone out")));

  app.get("/calendar", (context) => {
    const from = context.req.query("from") ?? new Date(now().getTime() - 30 * 86_400_000).toISOString();
    const to = context.req.query("to") ?? new Date(now().getTime() + 60 * 86_400_000).toISOString();
    if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) return refuse(context, 400, "Not a span of time");
    return ok(context, { from, to, entries: deps.content.calendar(new Date(from).toISOString(), new Date(to).toISOString()) });
  });

  /** Sends one scheduled post now, whenever it was planned for. */
  app.post("/schedules/:scheduleId/post", async (context) => {
    const scheduleId = context.req.param("scheduleId");
    const found = deps.content
      .calendar(new Date(0).toISOString(), new Date(now().getTime() + 10 * 365 * 86_400_000).toISOString())
      .find((entry) => entry.id === scheduleId);
    if (!found) return refuse(context, 404, "No such planned post");
    if (found.status === "published") return refuse(context, 409, "That post has already gone out");
    const item = deps.content.read(found.item_id);
    if (!item) return refuse(context, 404, "No such post");
    const outcome = await publishSchedule(publishDeps(), found, item);
    if (outcome.ok) return ok(context, deps.content.read(found.item_id), "Posted");
    return context.json(envelope(context.get("requestId") ?? "unknown", deps.content.read(found.item_id), false, `Not posted: ${outcome.error}`), outcome.status);
  });

  /** Publishes everything whose moment has come, the same work the timer does. */
  app.post("/tick", async (context) => ok(context, await runDueSchedules(publishDeps()), "Checked"));

  return app;
}
