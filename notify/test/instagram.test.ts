import assert from "node:assert/strict";
import test from "node:test";

import { classifyInstagramError, createChannels, createInstagramChannel, instagramPictures, instagramPostUrl, instagramPublishingLimit, instagramText, listInstagramAccounts, message, sendDirect } from "../src/index.ts";

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
const instant = { sleep: async () => {}, readyTimeoutMs: 0 };

const post = message({
  title: "බඩු ගන්නකොට සල්ලි ඉතුරු කරන්න",
  summary: "පහසු ක්‍රම පහක්.",
  actions: [{ label: "Link in bio", url: "https://badumila.com/deals" }],
  image: { url: "https://badumila.com/content/abc.jpg" },
  footer: "Independent, not affiliated with any store.",
  tags: ["badumila", "#SriLanka"],
});

test("an instagram caption is plain text: addresses named not linked, hashtags last, cut to the limit", () => {
  const caption = instagramText(post);
  assert.equal(caption, ["බඩු ගන්නකොට සල්ලි ඉතුරු කරන්න", "පහසු ක්‍රම පහක්.", "Link in bio: badumila.com/deals", "Independent, not affiliated with any store.", "#badumila #SriLanka"].join("\n\n"));
  assert.ok(!caption.includes("https://"), "no address is left as a link");
  assert.ok(instagramText(message({ ...post, summary: "x".repeat(4000) }), 300).length <= 300);
});

test("one picture is one container, then published, and the permalink comes back as the reference", async () => {
  const { calls, request } = recorder((call) => {
    if (call.url.includes("/media_publish")) return json({ id: "MEDIA-1" });
    if (call.url.includes("/media")) return json({ id: "CONTAINER-1" });
    return json({ permalink: "https://www.instagram.com/p/XYZ/" });
  });
  const instagram = createInstagramChannel({ accountToken: (id) => (id === "17841400000000000" ? "PAGE-TOKEN" : null), appSecret: "shh", fetch: request, ...instant });
  const sent = await instagram.send({ kind: "instagram", address: "17841400000000000" }, post);

  assert.deepEqual(sent, { ok: true, reference: "https://www.instagram.com/p/XYZ/" });
  const container = calls[0];
  assert.equal(container?.method, "POST");
  assert.ok(container?.url.endsWith("/17841400000000000/media"));
  assert.equal(container?.form.get("image_url"), "https://badumila.com/content/abc.jpg");
  assert.ok(container?.form.get("caption")?.startsWith("බඩු ගන්නකොට"));
  assert.equal(container?.form.get("access_token"), "PAGE-TOKEN", "the token travels in the body");
  assert.ok(!container?.url.includes("PAGE-TOKEN"), "and never in the address");
  assert.ok(container?.form.get("appsecret_proof"), "every call carries the app secret proof");
  assert.equal(calls.at(-2)?.form.get("creation_id"), "CONTAINER-1");
});

test("several pictures make a carousel: a container each, then one for the set, then published", async () => {
  let child = 0;
  const { calls, request } = recorder((call) => {
    if (call.url.includes("/media_publish")) return json({ id: "MEDIA-9" });
    if (call.url.includes("/media")) return json({ id: call.form.get("media_type") === "CAROUSEL" ? "PARENT" : `CHILD-${(child += 1)}` });
    return json({ permalink: "https://www.instagram.com/p/SET/" });
  });
  const instagram = createInstagramChannel({ accountToken: () => "PAGE-TOKEN", appSecret: "shh", fetch: request, ...instant });
  const slides = ["one", "two", "three"].map((name) => ({ url: `https://badumila.com/content/${name}.jpg` }));
  const sent = await instagram.send({ kind: "instagram", address: "17841400000000000" }, message({ ...post, images: slides }));

  assert.deepEqual(sent, { ok: true, reference: "https://www.instagram.com/p/SET/" });
  const children = calls.filter((call) => call.form.get("is_carousel_item") === "true");
  assert.equal(children.length, 3);
  assert.deepEqual(children.map((call) => call.form.get("image_url")), slides.map((slide) => slide.url));
  assert.ok(children.every((call) => !call.form.get("caption")), "a slide carries no caption of its own");
  const parent = calls.find((call) => call.form.get("media_type") === "CAROUSEL");
  assert.equal(parent?.form.get("children"), "CHILD-1,CHILD-2,CHILD-3");
  assert.ok(parent?.form.get("caption"), "the caption belongs to the set");
});

test("instagram takes no post without a picture, and only a digits-only account id", async () => {
  const instagram = createInstagramChannel({ accountToken: () => "PAGE-TOKEN", fetch: (async () => json({}))as typeof fetch, ...instant });
  const bare = await instagram.send({ kind: "instagram", address: "17841400000000000" }, message({ title: "Nothing to show" }));
  assert.equal(bare.ok, false);
  assert.match(bare.ok ? "" : bare.error, /INSTAGRAM_NO_PICTURE/u);
  const named = await instagram.send({ kind: "instagram", address: "badumila" }, post);
  assert.equal(named.ok, false);
  assert.match(named.ok ? "" : named.error, /INSTAGRAM_ACCOUNT_INVALID/u);
});

test("a publishing step that fails stops the post before anything is published", async () => {
  const { calls, request } = recorder(() => json({ error: { message: "The image is not a JPEG", code: 2207052 } }, 400));
  const instagram = createInstagramChannel({ accountToken: () => "PAGE-TOKEN", fetch: request, ...instant });
  const sent = await instagram.send({ kind: "instagram", address: "17841400000000000" }, post);
  assert.equal(sent.ok, false);
  assert.match(sent.ok ? "" : sent.error, /INSTAGRAM_2207052: The image is not a JPEG/u);
  assert.equal(sent.ok || sent.retryable, false, "a picture Instagram will not take is not tried again");
  assert.equal(calls.length, 1, "nothing was published");
});

test("an unconnected account is gone, and the errors sort into gone, waited on, and refused", async () => {
  const instagram = createInstagramChannel({ accountToken: () => null, fetch: (async () => json({})) as typeof fetch, ...instant });
  const sent = await instagram.send({ kind: "instagram", address: "17841400000000000" }, post);
  assert.equal(sent.ok || sent.gone, true);

  assert.deepEqual(classifyInstagramError({ code: 190 }, 400), { retryable: false, gone: true, retryAfterMs: undefined });
  assert.deepEqual(classifyInstagramError({ code: 9007 }, 400), { retryable: true, gone: false, retryAfterMs: undefined });
  assert.deepEqual(classifyInstagramError({ code: 4 }, 400), { retryable: true, gone: false, retryAfterMs: 3_600_000 });
  assert.deepEqual(classifyInstagramError({ code: 25 }, 400), { retryable: true, gone: false, retryAfterMs: 6 * 3_600_000 });
  assert.deepEqual(classifyInstagramError({ code: 100 }, 400), { retryable: false, gone: false, retryAfterMs: undefined });
});

test("the accounts behind the shared Pages are found, and the day's remaining posts read", async () => {
  const { request } = recorder((call) =>
    call.url.includes("content_publishing_limit")
      ? json({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] })
      : json(call.url.includes("/linked?") ? { instagram_business_account: { id: "17841400000000000", username: "badumila", name: "බඩු මිල", profile_picture_url: "https://cdn.example/p.jpg" } } : {}),
  );
  const app = { appId: "app", appSecret: "shh", fetch: request };
  const found = await listInstagramAccounts(app, [
    { id: "linked", name: "PriceLens Sri Lanka", token: "PAGE-TOKEN", canPost: true },
    { id: "unlinked", name: "Another Page", token: "OTHER-TOKEN", canPost: true },
  ]);
  assert.equal(found.length, 1, "a Page with no linked account brings none");
  assert.deepEqual(found[0], { id: "17841400000000000", username: "badumila", name: "බඩු මිල", picture: "https://cdn.example/p.jpg", pageId: "linked", pageName: "PriceLens Sri Lanka", token: "PAGE-TOKEN", canPost: true });
  assert.deepEqual(await instagramPublishingLimit(app, "17841400000000000", "PAGE-TOKEN"), { used: 3, cap: 100 });
});

test("the registry builds instagram only when it can look a token up, and a picture set is capped at ten", () => {
  assert.equal(createChannels({}).has("instagram"), false);
  assert.equal(createChannels({ instagram: { accountToken: () => "PAGE-TOKEN" } }).has("instagram"), true);
  const slides = (count: number) => Array.from({ length: count }, () => ({ url: "https://badumila.com/content/a.jpg" }));
  assert.equal(instagramPictures(message({ ...post, images: slides(10) })).length, 10);
  assert.throws(() => message({ ...post, images: slides(11) }), /too_big|at most/u, "an eleventh slide is refused before it reaches a channel");
  assert.deepEqual(instagramPictures(message({ title: "No picture" })), []);
  assert.equal(instagramPostUrl("https://www.instagram.com/p/XYZ/"), "https://www.instagram.com/p/XYZ/");
  assert.equal(instagramPostUrl("17841400000000000"), null);
});

test("a message for instagram when it is not configured dies with a clear reason", async () => {
  const sent = await sendDirect(createChannels({}), { kind: "instagram", address: "17841400000000000" }, post);
  assert.equal(sent.ok, false);
  assert.match(sent.ok ? "" : sent.error, /CHANNEL_UNAVAILABLE: instagram/u);
});
