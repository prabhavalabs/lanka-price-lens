import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";

import { saveDealsDay } from "@lanka-pricelens/foundry/deals";
import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { createMemoryOutbox, facebookText } from "@lanka-pricelens/notify";

import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { dealsCardSvg, facebookDealsPost, postCardHeight, postCardWidth, postDeals, renderDealsCard } from "../src/social/post.ts";
import { facebookStateCookie, readConnectState, signConnectState } from "../src/social/routes.ts";
import { openToken, sealToken } from "../src/social/seal.ts";
import { createSocialStore } from "../src/social/accounts.ts";
import { sampleDealsDay } from "../src/newsletters/admin-routes.ts";
import { createNewsletterService } from "../src/newsletters/service.ts";
import { createAccountStore } from "../src/account/store.ts";

const now = new Date("2026-09-20T02:00:00.000Z");
const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
const page = (id: string, name: string, canPost = true) => ({ id, name, token: `token-of-${id}`, link: `https://www.facebook.com/${id}`, canPost });

test("a sealed token opens only under the secret it was sealed with", () => {
  const sealed = sealToken("EAAB-page-token", "state-secret");
  assert.ok(sealed.startsWith("v1."));
  assert.ok(!sealed.includes("EAAB"));
  assert.notEqual(sealed, sealToken("EAAB-page-token", "state-secret"), "a fresh nonce every time");
  assert.equal(openToken(sealed, "state-secret"), "EAAB-page-token");
  assert.equal(openToken(sealed, "another-secret"), null);
  assert.equal(openToken(`${sealed.slice(0, -2)}AA`, "state-secret"), null);
  assert.equal(openToken("plain-text", "state-secret"), null);
});

test("the store keeps tokens sealed, one Page active, and a dead token out of the channel's reach", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createSocialStore(database, "state-secret");
    const pages = store.connect({ pages: [page("555000111", "Read only", false), page("1234567890", "PriceLens")], instagram: [] }, "Nipun", now);
    assert.deepEqual(pages.map((entry) => [entry.name, entry.active, entry.can_post]), [["PriceLens", true, true], ["Read only", false, false]]);
    assert.equal(store.tokenFor("facebook", "1234567890"), "token-of-1234567890");
    const raw = database.prepare("SELECT token_sealed FROM social_account WHERE platform = 'facebook' AND account_id = '1234567890'").get() as { token_sealed: string };
    assert.ok(!raw.token_sealed.includes("token-of"), "the database never holds the token in the clear");
    assert.equal(createSocialStore(database, "rotated-secret").tokenFor("facebook", "1234567890"), null);

    assert.equal(store.activate("facebook", "555000111", now), true);
    assert.equal(store.active("facebook")?.account_id, "555000111");
    assert.equal(store.list().filter((entry) => entry.active).length, 1);
    assert.equal(store.activate("facebook", "unknown", now), false);

    store.setPaused("facebook", "1234567890", true, now);
    store.markToken("facebook", "1234567890", { valid: false, error: "FACEBOOK_190: session invalidated" }, now);
    assert.equal(store.tokenFor("facebook", "1234567890"), null);
    const dead = store.list().find((entry) => entry.account_id === "1234567890")!;
    assert.deepEqual([dead.token_status, dead.token_error, dead.paused], ["invalid", "FACEBOOK_190: session invalidated", true]);

    // Connecting again brings the token back and keeps the switches the owner set.
    store.connect({ pages: [page("1234567890", "PriceLens Sri Lanka")], instagram: [] }, "Nipun", new Date(now.getTime() + 60_000));
    const back = store.list().find((entry) => entry.account_id === "1234567890")!;
    assert.deepEqual([back.name, back.token_status, back.paused, back.active], ["PriceLens Sri Lanka", "ok", true, false]);
    assert.equal(store.tokenFor("facebook", "1234567890"), "token-of-1234567890");
    assert.equal(store.disconnect("facebook", "1234567890"), 1);
    assert.equal(store.disconnect(), 1);
    assert.deepEqual(store.list(), []);
  } finally {
    database.close();
  }
});

test("the day's post: the stores' own offers lead, one row per product, a picture of ours, no store links in the caption", () => {
  const day = sampleDealsDay("2026-09-20");
  const rows = postDeals(day);
  assert.ok(rows.length >= 3 && rows.length <= 6);
  assert.equal(rows[0]!.note === "for everyone" || rows[0]!.note.endsWith("members"), true, "a store offer leads");
  assert.equal(new Set(rows.map((row) => row.label)).size, rows.length);

  const post = facebookDealsPost(day, "https://price.example/");
  assert.ok(post);
  assert.equal(post.image?.url, "https://price.example/og/deals/2026-09-20.png");
  assert.equal(post.dedupe_key, "facebook:deals_daily:2026-09-20");
  assert.deepEqual(post.actions, [{ label: "Every offer, with the link to the store", url: "https://price.example/deals" }]);
  const caption = facebookText(post);
  assert.match(caption, /^Supermarket deals · Sunday 20 September\n\n/u);
  assert.match(caption, /not affiliated with any store/u);
  assert.equal((caption.match(/https?:\/\//gu) ?? []).length, 1, "one link, to the deals page");
  assert.ok(caption.length < 1800);
  // The opening line turns with the day, so two mornings do not read the same.
  assert.notEqual(facebookDealsPost(sampleDealsDay("2026-09-21"), "https://price.example")?.summary, post.summary);
  assert.equal(facebookDealsPost({ ...day, deals: [], cheapest: [], store_offers: [] }, "https://price.example"), null);
});

test("the post's picture is drawn here: the day, the rows, the site's address, and nothing of a store but its name", () => {
  const day = sampleDealsDay("2026-09-20");
  const rows = postDeals(day);
  const svg = dealsCardSvg(day.day, rows);
  assert.match(svg, /Sunday 20 September/u);
  assert.match(svg, /badumila\.com\/deals/u);
  assert.ok(svg.includes(rows[0]!.now));
  assert.equal((svg.match(/<image /gu) ?? []).length <= 1, true, "the only image is the site's own mark");
  const png = renderDealsCard(day.day, rows);
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(png.readUInt32BE(16), postCardWidth);
  assert.equal(png.readUInt32BE(20), postCardHeight);
});

test("the connect state is signed, short-lived, and bound to its purpose", () => {
  const exp = Math.floor(now.getTime() / 1000) + 600;
  const cookie = signConnectState({ state: "abc", exp }, "state-secret");
  assert.deepEqual(readConnectState(cookie, "state-secret", now), { state: "abc", exp });
  assert.equal(readConnectState(cookie, "other-secret", now), null);
  assert.equal(readConnectState(cookie, "state-secret", new Date(now.getTime() + 601_000)), null);
  assert.equal(readConnectState(`${cookie}x`, "state-secret", now), null);
  assert.equal(readConnectState(undefined, "state-secret", now), null);
});

/** A Graph API that knows one code, one person, and one Page, and records what was posted. */
function fakeFacebook() {
  const posted: Array<{ path: string; form: URLSearchParams }> = [];
  const mood = { limited: false };
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/oauth/access_token")) return url.searchParams.get("code") === "good-code" || url.searchParams.get("grant_type") === "fb_exchange_token" ? answer({ access_token: "USER-TOKEN" }) : answer({ error: { message: "This authorization code has expired.", code: 100 } }, 400);
    if (url.pathname.endsWith("/me")) return answer({ name: "Nipun" });
    if (url.pathname.endsWith("/me/accounts")) return answer({ data: [{ id: "1234567890", name: "PriceLens", access_token: "PAGE-TOKEN", link: "https://www.facebook.com/pricelens", tasks: ["CREATE_CONTENT"] }] });
    if (url.pathname.endsWith("/debug_token")) return answer({ data: { is_valid: true, expires_at: 0, scopes: ["pages_manage_posts", "instagram_content_publish"] } });
    // The Instagram account hangs off the Page and is reached with the Page's own token.
    if (url.searchParams.get("fields")?.startsWith("instagram_business_account")) return answer({ instagram_business_account: { id: "17841400000000000", username: "badumila", name: "\u0db6\u0da9\u0dd4 \u0db8\u0dd2\u0dbd", profile_picture_url: "https://cdn.example/p.jpg" } });
    if (url.pathname.endsWith("/content_publishing_limit")) return answer({ data: [{ quota_usage: 2, config: { quota_total: 100 } }] });
    if (init?.method === "POST" && mood.limited) return answer({ error: { message: "(#32) Page request limit reached", code: 32 } }, 400);
    if (init?.method === "POST") {
      posted.push({ path: url.pathname, form: new URLSearchParams(String(init.body)) });
      return answer({ id: "777", post_id: "1234567890_777" });
    }
    return answer({ error: { message: "unknown", code: 100 } }, 400);
  }) as typeof fetch;
  return { posted, request, mood };
}

test("the admin connects a Page through Facebook Login, previews the day, and posts it", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const salt = "0123456789abcdef0123456789abcdef";
    seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
    saveDealsDay(database, sampleDealsDay("2026-09-20"));
    const facebook = fakeFacebook();
    const app = createApp(database, undefined, undefined, { accounts: { config: { siteOrigin: "https://price.example.test", stateSecret: "state-secret" } }, facebook: { app: { appId: "4242", appSecret: "shh", fetch: facebook.request }, fetch: facebook.request } });

    assert.equal((await app.request("/v1/admin/distribution", { headers: json })).status, 401);
    const login = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    assert.equal(login.status, 200);
    const admin = /lpl_admin_session=([^;]+)/u.exec(login.headers.get("set-cookie") ?? "")?.[0] ?? "";
    assert.ok(admin);

    const empty = (await (await app.request("/v1/admin/distribution", { headers: { ...json, cookie: admin } })).json()) as { payload: { configured: boolean; redirect_uri: string; accounts: unknown[] } };
    assert.deepEqual([empty.payload.configured, empty.payload.redirect_uri, empty.payload.accounts.length], [true, "http://localhost/v1/admin/facebook/callback", 0]);

    // Connect: the admin session opens the consent screen and leaves the signed state behind.
    assert.equal((await app.request("/v1/admin/distribution/connect", { headers: { host: "localhost" } })).status, 401);
    const connect = await app.request("/v1/admin/distribution/connect", { headers: { host: "localhost", cookie: admin } });
    assert.equal(connect.status, 302);
    const consent = new URL(connect.headers.get("location") ?? "");
    assert.equal(consent.hostname, "www.facebook.com");
    assert.equal(consent.searchParams.get("redirect_uri"), "http://localhost/v1/admin/facebook/callback");
    const stateCookie = new RegExp(`${facebookStateCookie}=([^;]+)`, "u").exec(connect.headers.get("set-cookie") ?? "")?.[0] ?? "";
    assert.match(connect.headers.get("set-cookie") ?? "", /HttpOnly/u);
    const state = consent.searchParams.get("state") ?? "";

    // The callback arrives without the admin session (SameSite=Strict) and answers to the state cookie alone.
    const forged = await app.request(`/v1/admin/facebook/callback?code=good-code&state=${state}`, { headers: { host: "localhost" } });
    assert.equal(forged.headers.get("location"), "/admin/distribution/facebook?facebook=expired");
    const mismatched = await app.request("/v1/admin/facebook/callback?code=good-code&state=someone-elses", { headers: { host: "localhost", cookie: stateCookie } });
    assert.equal(mismatched.headers.get("location"), "/admin/distribution/facebook?facebook=expired");
    const cancelled = await app.request(`/v1/admin/facebook/callback?error=access_denied&state=${state}`, { headers: { host: "localhost", cookie: stateCookie } });
    assert.equal(cancelled.headers.get("location"), "/admin/distribution/facebook?facebook=cancelled");
    const refused = await app.request(`/v1/admin/facebook/callback?code=stale-code&state=${state}`, { headers: { host: "localhost", cookie: stateCookie } });
    assert.equal(refused.headers.get("location"), "/admin/distribution/facebook?facebook=failed");
    const connected = await app.request(`/v1/admin/facebook/callback?code=good-code&state=${state}`, { headers: { host: "localhost", cookie: stateCookie } });
    assert.equal(connected.headers.get("location"), "/admin/distribution/facebook?facebook=connected");

    const status = (await (await app.request("/v1/admin/distribution", { headers: { ...json, cookie: admin } })).json()) as { payload: { accounts: Array<Record<string, unknown>> } };
    // One Facebook Page, and the Instagram account behind it, both active because nothing else was.
    assert.equal(status.payload.accounts.length, 2);
    const connectedPage = status.payload.accounts.find((entry) => entry.platform === "facebook")!;
    assert.deepEqual([connectedPage.name, connectedPage.active, connectedPage.connected_by], ["PriceLens", true, "Nipun"]);
    const connectedInstagram = status.payload.accounts.find((entry) => entry.platform === "instagram")!;
    assert.deepEqual([connectedInstagram.username, connectedInstagram.active, connectedInstagram.parent_id], ["badumila", true, "1234567890"]);
    assert.ok(!JSON.stringify(status.payload).includes("PAGE-TOKEN"), "the token never leaves the server");

    const preview = (await (await app.request("/v1/admin/distribution/deals/preview?day=2026-09-20", { headers: { ...json, cookie: admin } })).json()) as { payload: { ready: boolean; caption: string; image_url: string } };
    assert.equal(preview.payload.ready, true);
    assert.equal(preview.payload.image_url, "https://price.example.test/og/deals/2026-09-20.png");
    const card = await app.request("/og/deals/2026-09-20.png");
    assert.equal(card.status, 200);
    assert.equal(card.headers.get("content-type"), "image/png");

    const check = (await (await app.request("/v1/admin/distribution/accounts/facebook/check", { method: "POST", headers: { ...json, cookie: admin } })).json()) as { message: string };
    assert.equal(check.message, "The token is accepted");

    const posted = (await (await app.request("/v1/admin/distribution/deals/post", { method: "POST", headers: { ...json, cookie: admin }, body: JSON.stringify({ day: "2026-09-20" }) })).json()) as { message: string; payload: { post: { status: string; url: string }; posts: unknown[] } };
    assert.equal(posted.message, "Posted");
    assert.equal(posted.payload.post.url, "https://www.facebook.com/1234567890_777");
    assert.equal(facebook.posted.length, 1);
    assert.equal(facebook.posted[0]!.path, "/v25.0/1234567890/photos");
    assert.equal(facebook.posted[0]!.form.get("access_token"), "PAGE-TOKEN");
    assert.equal(facebook.posted[0]!.form.get("caption"), preview.payload.caption);

    // Facebook's refusal reaches the owner, and a post made by hand is not tried again later on its own.
    facebook.mood.limited = true;
    const limited = await app.request("/v1/admin/distribution/deals/post", { method: "POST", headers: { ...json, cookie: admin }, body: JSON.stringify({ day: "2026-09-20" }) });
    assert.equal(limited.status, 502);
    const refusal = (await limited.json()) as { success: boolean; message: string; payload: { posts: Array<{ status: string }> } };
    assert.deepEqual([refusal.success, refusal.message], [false, "Not posted: FACEBOOK_32: (#32) Page request limit reached"]);
    assert.deepEqual(refusal.payload.posts.map((entry) => entry.status), ["dead", "sent"]);
    facebook.mood.limited = false;

    // Paused, then disconnected.
    const paused = await app.request("/v1/admin/distribution/accounts/facebook/1234567890/pause", { method: "POST", headers: { ...json, cookie: admin }, body: JSON.stringify({ paused: true }) });
    assert.equal(paused.status, 200);
    assert.equal((await app.request("/v1/admin/distribution/accounts/facebook/1234567890", { method: "DELETE", headers: { ...json, cookie: admin } })).status, 200);
    assert.equal((await app.request("/v1/admin/distribution/deals/post", { method: "POST", headers: { ...json, cookie: admin }, body: "{}" })).status, 409);
  } finally {
    database.close();
  }
});

test("the deals run queues the Page's post once a day, and not while the Page is paused", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const outbox = createMemoryOutbox();
    let pageId: string | null = "1234567890";
    const day = sampleDealsDay("2026-09-20");
    const service = createNewsletterService({ database, accounts: createAccountStore(database), outbox, siteOrigin: "https://price.example", secret: "state-secret", replyTo: "hello@example.com", deals: { read: () => day, latest: () => day, compute: async () => day }, facebook: { page: () => pageId }, now: () => now, log: () => undefined });
    const first = await service.runNewsletter("deals_daily", { day: "2026-09-20", trigger: "test" });
    assert.equal(first.run.report?.facebook_post, 1);
    const again = await service.runNewsletter("deals_daily", { day: "2026-09-20", trigger: "test", force: true });
    assert.equal(again.run.report?.facebook_post, 0, "the outbox keeps the day to one post");
    const queued = outbox.recent(10).filter((entry) => entry.target.kind === "facebook");
    assert.equal(queued.length, 1);
    assert.deepEqual([queued[0]!.target.address, queued[0]!.dedupeKey, queued[0]!.message.image?.url], ["1234567890", "facebook:deals_daily:2026-09-20", "https://price.example/og/deals/2026-09-20.png"]);

    pageId = null;
    const paused = await service.runNewsletter("deals_daily", { day: "2026-09-21", trigger: "test" });
    assert.equal(paused.run.report?.facebook_post, undefined);
  } finally {
    database.close();
  }
});
