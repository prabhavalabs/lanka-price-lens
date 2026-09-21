import assert from "node:assert/strict";
import test from "node:test";

import { createChannels, createFacebookChannel, exchangeFacebookCode, extendFacebookToken, facebookLoginUrl, facebookPostUrl, facebookProof, facebookText, FacebookGraphError, inspectFacebookToken, listFacebookPages, message, sendDirect } from "../src/index.ts";

type Call = { url: string; method: string; form: URLSearchParams };

function recorder(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), method: init?.method ?? "GET", form: new URLSearchParams(init?.body ? String(init.body) : "") };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, request };
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const digest = message({
  title: "Today's supermarket deals · Sunday 20 September",
  summary: "What the stores marked down this morning.",
  sections: [{ heading: "Store offers", lines: [{ text: "Red cowpea", value: "Rs 595 / 500 g", change: -30, note: "at Cargills", url: "https://price.example/p/product_cowpea" }] }],
  actions: [{ label: "All of today's offers", url: "https://price.example/deals" }],
  image: { url: "https://price.example/cards/deals/2026-09-20.png" },
  footer: "Prices as listed on each store's own site.",
});

test("facebook text is plain: no line links, the actions at the foot, sections cut on whole lines", () => {
  const text = facebookText(digest);
  assert.equal(text, ["Today's supermarket deals · Sunday 20 September", "What the stores marked down this morning.", "STORE OFFERS\n• Red cowpea: Rs 595 / 500 g (-30%) — at Cargills", "All of today's offers: https://price.example/deals", "Prices as listed on each store's own site."].join("\n\n"));
  assert.ok(!text.includes("product_cowpea"));

  const long = message({ ...digest, sections: [{ heading: "Store offers", lines: Array.from({ length: 50 }, (_, index) => ({ text: `Product number ${index} with a long name`, value: "Rs 1,234 / kg", change: -12.5 })) }] });
  const cut = facebookText(long, 600);
  assert.ok(cut.length <= 600);
  assert.ok(cut.includes("\n…\n\n"), "the dropped remainder is marked");
  assert.ok(cut.endsWith("Prices as listed on each store's own site."), "the footer stays whole");
  assert.ok(cut.includes("https://price.example/deals"), "the link stays whole");
});

test("facebook publishes a message with a picture as a Page photo, one without to the feed, the token in the body", async () => {
  const { calls, request } = recorder((call) => json(call.url.endsWith("/photos") ? { id: "9001", post_id: "1234567890_9001" } : { id: "1234567890_9002" }));
  const facebook = createFacebookChannel({ pageToken: (pageId) => (pageId === "1234567890" ? "PAGE-TOKEN" : null), appSecret: "shh", fetch: request });
  const photo = await facebook.send({ kind: "facebook", address: "1234567890" }, digest);
  assert.deepEqual(photo, { ok: true, reference: "1234567890_9001" });
  assert.equal(calls[0]!.url, "https://graph.facebook.com/v25.0/1234567890/photos");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.form.get("url"), "https://price.example/cards/deals/2026-09-20.png");
  assert.equal(calls[0]!.form.get("caption"), facebookText(digest));
  assert.equal(calls[0]!.form.get("access_token"), "PAGE-TOKEN");
  assert.equal(calls[0]!.form.get("appsecret_proof"), facebookProof("PAGE-TOKEN", "shh"));
  assert.ok(!calls[0]!.url.includes("PAGE-TOKEN"), "the token never rides in the address");

  const { image: _image, ...plain } = digest;
  const feed = await facebook.send({ kind: "facebook", address: "1234567890" }, message(plain));
  assert.deepEqual(feed, { ok: true, reference: "1234567890_9002" });
  assert.equal(calls[1]!.url, "https://graph.facebook.com/v25.0/1234567890/feed");
  assert.equal(calls[1]!.form.get("link"), "https://price.example/deals");
  assert.equal(facebook.describe({ kind: "facebook", address: "1234567890" }), "facebook:123…890");
  assert.equal(facebookPostUrl("1234567890_9001"), "https://www.facebook.com/1234567890_9001");
});

test("facebook: a dead token or a missing permission is gone, a rate limit waits an hour, a refused post is final", async () => {
  const sendWith = async (body: unknown, status: number) => createFacebookChannel({ pageToken: () => "t", fetch: recorder(() => json(body, status)).request }).send({ kind: "facebook", address: "1234567890" }, digest);

  const expired = await sendWith({ error: { message: "Error validating access token: The session has been invalidated.", type: "OAuthException", code: 190, error_subcode: 460 } }, 400);
  assert.equal(expired.ok, false);
  if (!expired.ok) {
    assert.equal(expired.gone, true);
    assert.match(expired.error, /^FACEBOOK_190_460: Error validating access token/u);
  }
  const forbidden = await sendWith({ error: { message: "(#200) The user has not granted pages_manage_posts", code: 200 } }, 403);
  assert.ok(!forbidden.ok && forbidden.gone);

  const limited = await sendWith({ error: { message: "(#32) Page request limit reached", code: 32 } }, 400);
  assert.ok(!limited.ok && limited.retryable && !limited.gone);
  if (!limited.ok) assert.equal(limited.retryAfterMs, 3_600_000);

  const picture = await sendWith({ error: { message: "(#324) Missing or invalid image file", code: 324 } }, 400);
  assert.ok(!picture.ok && picture.retryable);

  const refused = await sendWith({ error: { message: "(#368) The action attempted has been deemed abusive or is otherwise disallowed", code: 368 } }, 400);
  assert.ok(!refused.ok && !refused.retryable && !refused.gone);

  const outage = await sendWith("upstream unavailable", 503);
  assert.ok(!outage.ok && outage.retryable);

  const offline = await createFacebookChannel({ pageToken: () => "t", fetch: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch }).send({ kind: "facebook", address: "1234567890" }, digest);
  assert.ok(!offline.ok && offline.retryable);
});

test("facebook: a Page that is not connected is gone without a request; the registry carries the channel only when configured", async () => {
  const { calls, request } = recorder(() => json({ id: "1" }));
  const channels = createChannels({ facebook: { pageToken: () => null }, fetch: request });
  const delivery = await sendDirect(channels, { kind: "facebook", address: "1234567890" }, digest);
  assert.ok(!delivery.ok && delivery.gone);
  assert.equal(calls.length, 0);
  const bad = await sendDirect(channels, { kind: "facebook", address: "not-a-page" }, digest);
  assert.ok(!bad.ok && /FACEBOOK_PAGE_INVALID/u.test(bad.error));
  const none = await sendDirect(createChannels({}), { kind: "facebook", address: "1234567890" }, digest);
  assert.ok(!none.ok && /CHANNEL_UNAVAILABLE/u.test(none.error));
});

test("connecting a Page: the consent address, the code for a token, the long-lived token, the Pages with their own tokens", async () => {
  const login = new URL(facebookLoginUrl({ appId: "4242", redirectUri: "https://admin.example/v1/admin/facebook/callback", state: "abc" }));
  assert.equal(login.origin + login.pathname, "https://www.facebook.com/v25.0/dialog/oauth");
  assert.equal(login.searchParams.get("client_id"), "4242");
  assert.equal(login.searchParams.get("state"), "abc");
  assert.equal(login.searchParams.get("scope"), "pages_show_list,pages_manage_posts,pages_read_engagement,business_management");

  const { calls, request } = recorder((call) => {
    const url = new URL(call.url);
    if (url.pathname.endsWith("/oauth/access_token")) return json({ access_token: url.searchParams.get("grant_type") === "fb_exchange_token" ? "LONG" : "SHORT" });
    if (url.pathname.endsWith("/me")) return json({ name: "Nipun" });
    if (url.pathname.endsWith("/me/accounts")) return json({ data: [{ id: "1234567890", name: "PriceLens", access_token: "PAGE-TOKEN", link: "https://www.facebook.com/pricelens", tasks: ["CREATE_CONTENT", "MANAGE"] }, { id: "555", name: "Read only", access_token: "OTHER", tasks: ["ANALYZE"] }, { id: "no-token" }] });
    if (url.pathname.endsWith("/debug_token")) return json({ data: { is_valid: true, expires_at: 0, data_access_expires_at: 1790000000, scopes: ["pages_manage_posts"] } });
    return json({ error: { message: "unknown", code: 100 } }, 400);
  });
  const app = { appId: "4242", appSecret: "shh", fetch: request };
  assert.equal(await exchangeFacebookCode(app, "the-code", "https://admin.example/v1/admin/facebook/callback"), "SHORT");
  assert.equal(new URL(calls[0]!.url).searchParams.get("redirect_uri"), "https://admin.example/v1/admin/facebook/callback");
  assert.equal(await extendFacebookToken(app, "SHORT"), "LONG");
  const found = await listFacebookPages(app, "LONG");
  assert.equal(found.person, "Nipun");
  assert.deepEqual(found.pages, [
    { id: "1234567890", name: "PriceLens", token: "PAGE-TOKEN", link: "https://www.facebook.com/pricelens", canPost: true },
    { id: "555", name: "Read only", token: "OTHER", link: null, canPost: false },
  ]);
  const health = await inspectFacebookToken(app, "PAGE-TOKEN");
  assert.deepEqual(health, { valid: true, expiresAt: null, dataAccessExpiresAt: new Date(1790000000 * 1000).toISOString(), scopes: ["pages_manage_posts"], error: null });
  assert.equal(new URL(calls.at(-1)!.url).searchParams.get("access_token"), "4242|shh");
});

test("connecting a Page: Facebook's refusal is an error with its code, and never carries the secret", async () => {
  const app = { appId: "4242", appSecret: "very-secret", fetch: recorder(() => json({ error: { message: "This authorization code has been used.", code: 100 } }, 400)).request };
  await assert.rejects(exchangeFacebookCode(app, "used", "https://admin.example/cb"), (error: unknown) => {
    assert.ok(error instanceof FacebookGraphError);
    assert.equal(error.code, 100);
    assert.match(error.message, /^FACEBOOK_CODE_EXCHANGE: This authorization code has been used\./u);
    assert.ok(!error.message.includes("very-secret"));
    return true;
  });
  const offline = { appId: "4242", appSecret: "very-secret", fetch: (async (url: string | URL | Request) => { throw new Error(`fetch failed for ${String(url)}`); }) as typeof fetch };
  await assert.rejects(extendFacebookToken(offline, "SHORT"), (error: unknown) => error instanceof FacebookGraphError && !error.message.includes("very-secret"));
});

test("several pictures make one post holding all of them: each uploaded unpublished, then named by the post", async () => {
  let uploaded = 0;
  const { calls, request } = recorder((call) => json(call.url.endsWith("/photos") ? { id: `PHOTO-${(uploaded += 1)}` } : { id: "1234567890_9100" }));
  const facebook = createFacebookChannel({ pageToken: () => "PAGE-TOKEN", appSecret: "shh", fetch: request });
  const slides = ["one", "two", "three"].map((name) => ({ url: `https://price.example/content/${name}.jpg` }));
  const sent = await facebook.send({ kind: "facebook", address: "1234567890" }, message({ ...digest, images: slides }));

  assert.deepEqual(sent, { ok: true, reference: "1234567890_9100" });
  const photos = calls.filter((call) => call.url.endsWith("/photos"));
  assert.equal(photos.length, 3);
  assert.ok(photos.every((call) => call.form.get("published") === "false"), "a picture on its own is never shown");
  assert.ok(photos.every((call) => !call.form.get("caption")), "the words belong to the post, not to each picture");
  const feed = calls.at(-1);
  assert.ok(feed?.url.endsWith("/feed"));
  assert.equal(feed?.form.get("attached_media[0]"), JSON.stringify({ media_fbid: "PHOTO-1" }));
  assert.equal(feed?.form.get("attached_media[2]"), JSON.stringify({ media_fbid: "PHOTO-3" }));
  assert.ok(feed?.form.get("message")?.startsWith("Today's supermarket deals"));
});
