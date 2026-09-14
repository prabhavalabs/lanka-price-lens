import assert from "node:assert/strict";
import test from "node:test";

import { createChannels, createDiscordChannel, createEmailChannel, createSlackChannel, createTelegramChannel, generateVapidKeys, message, parseTelegramUpdate, sendDirect, telegramDeepLink } from "../src/index.ts";

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function recorder(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, request };
}

const short = message({ title: "Big onion down 12%", summary: "Rs 370 / kg at Keells.", image: { url: "https://price.example/og/p/product_big_onion.png" }, actions: [{ label: "Open", url: "https://price.example/p/product_big_onion" }] });

test("telegram sends a short message with an image as a photo, a long one as text with a large preview", async () => {
  const { calls, request } = recorder(() => new Response(JSON.stringify({ ok: true, result: { message_id: 42 } })));
  const telegram = createTelegramChannel({ token: "123:abc", fetch: request });
  const delivery = await telegram.send({ kind: "telegram", address: "555" }, short);
  assert.deepEqual(delivery, { ok: true, reference: "42" });
  assert.equal(calls[0]!.url, "https://api.telegram.org/bot123:abc/sendPhoto");
  assert.equal(calls[0]!.body.chat_id, "555");
  assert.equal(calls[0]!.body.parse_mode, "HTML");
  assert.ok(String(calls[0]!.body.caption).startsWith("<b>Big onion down 12%</b>"));

  const long = message({ ...short, sections: [{ heading: "Sellers", lines: Array.from({ length: 40 }, (_, index) => ({ text: `Seller ${index} with a long descriptive name`, value: "Rs 1,234 / kg", change: -2.5, note: "was Rs 1,266 yesterday" })) }] });
  await telegram.send({ kind: "telegram", address: "@pricelens", meta: { thread_id: 7 } }, long);
  assert.equal(calls[1]!.url, "https://api.telegram.org/bot123:abc/sendMessage");
  assert.deepEqual(calls[1]!.body.link_preview_options, { url: short.image!.url, prefer_large_media: true, show_above_text: true });
  assert.equal(calls[1]!.body.message_thread_id, 7);
  assert.equal(telegram.describe({ kind: "telegram", address: "@pricelens" }), "telegram:@pricelens");
  assert.equal(telegram.describe({ kind: "telegram", address: "123456789" }), "telegram:12…89");
});

test("telegram: a blocked bot is gone, a flood wait is retried after the given seconds", async () => {
  const blocked = createTelegramChannel({ token: "t", fetch: recorder(() => new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 })).request });
  const gone = await blocked.send({ kind: "telegram", address: "1" }, short);
  assert.equal(gone.ok, false);
  if (!gone.ok) {
    assert.equal(gone.gone, true);
    assert.match(gone.error, /TELEGRAM_HTTP_403: Forbidden: bot was blocked/u);
  }
  const flooded = createTelegramChannel({ token: "t", fetch: recorder(() => new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } }), { status: 429 })).request });
  const retry = await flooded.send({ kind: "telegram", address: "1" }, short);
  assert.equal(retry.ok, false);
  if (!retry.ok) {
    assert.equal(retry.retryable, true);
    assert.equal(retry.gone, false);
    assert.equal(retry.retryAfterMs, 7000);
  }
  const offline = createTelegramChannel({ token: "t", fetch: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch });
  const network = await offline.send({ kind: "telegram", address: "1" }, short);
  assert.equal(network.ok, false);
  if (!network.ok) assert.equal(network.retryable, true);
});

test("telegram updates: /start with a payload binds a chat; other text is passed through", () => {
  const start = parseTelegramUpdate({ update_id: 1, message: { message_id: 3, chat: { id: 987, type: "private" }, from: { id: 987, username: "reader", first_name: "Amal" }, text: "/start sub_abc-123" } });
  assert.deepEqual(start, { chatId: "987", chatType: "private", text: "/start sub_abc-123", startPayload: "sub_abc-123", from: { id: "987", username: "reader", firstName: "Amal" } });
  assert.equal(parseTelegramUpdate({ message: { chat: { id: 1, type: "private" }, text: "/start@PriceLensBot" } })?.startPayload, "");
  assert.equal(parseTelegramUpdate({ message: { chat: { id: 1, type: "private" }, text: "hello" } })?.startPayload, null);
  assert.equal(parseTelegramUpdate({ channel_post: { chat: { id: -100123, type: "channel" }, text: "news" } })?.chatId, "-100123");
  assert.equal(parseTelegramUpdate({ edited_message: {} }), null);
  assert.equal(parseTelegramUpdate("nope"), null);
  assert.equal(telegramDeepLink("@PriceLensBot", "sub_abc-123"), "https://t.me/PriceLensBot?start=sub_abc-123");
  assert.throws(() => telegramDeepLink("bot", "has space"), /TELEGRAM_PAYLOAD_INVALID/u);
});

test("discord posts one embed to the webhook with mentions off and reads the message id", async () => {
  const { calls, request } = recorder(() => new Response(JSON.stringify({ id: "9001" })));
  const discord = createDiscordChannel({ fetch: request });
  const delivery = await discord.send({ kind: "discord", address: "https://discord.com/api/webhooks/123/abc_DEF-ghi" }, short);
  assert.deepEqual(delivery, { ok: true, reference: "9001" });
  assert.equal(calls[0]!.url, "https://discord.com/api/webhooks/123/abc_DEF-ghi?wait=true");
  assert.equal(calls[0]!.body.username, "PriceLens");
  assert.deepEqual(calls[0]!.body.allowed_mentions, { parse: [] });
  assert.equal((calls[0]!.body.embeds as unknown[]).length, 1);
  const invalid = await discord.send({ kind: "discord", address: "https://example.com/hook" }, short);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.gone, true);
  const removed = createDiscordChannel({ fetch: recorder(() => new Response("Unknown Webhook", { status: 404 })).request });
  const gone = await removed.send({ kind: "discord", address: "https://discord.com/api/webhooks/1/a" }, short);
  assert.equal(gone.ok, false);
  if (!gone.ok) {
    assert.equal(gone.gone, true);
    assert.match(gone.error, /DISCORD_HTTP_404/u);
  }
  assert.equal(discord.describe({ kind: "discord", address: "https://discord.com/api/webhooks/123/abc_DEF-ghi" }), "discord:webhook abc…ghi");
});

test("slack posts blocks with a text fallback; a removed webhook is gone", async () => {
  const { calls, request } = recorder(() => new Response("ok"));
  const slack = createSlackChannel({ fetch: request });
  const delivery = await slack.send({ kind: "slack", address: "https://hooks.slack.com/services/T000/B000/xyz" }, short);
  assert.deepEqual(delivery, { ok: true, reference: null });
  assert.ok(Array.isArray(calls[0]!.body.blocks));
  assert.ok(String(calls[0]!.body.text).startsWith("Big onion down 12%"));
  const removed = createSlackChannel({ fetch: recorder(() => new Response("invalid_token", { status: 403 })).request });
  const gone = await removed.send({ kind: "slack", address: "https://hooks.slack.com/services/T000/B000/xyz" }, short);
  assert.equal(gone.ok, false);
  if (!gone.ok) assert.equal(gone.gone, true);
});

test("email goes through Resend with text and html; a bad key is not retried", async () => {
  const { calls, request } = recorder(() => new Response(JSON.stringify({ id: "email_1" })));
  const email = createEmailChannel({ apiKey: "re_test", from: "PriceLens <hello@example.com>", fetch: request });
  const delivery = await email.send({ kind: "email", address: "reader@example.com", meta: { reply_to: "owner@example.com" } }, short);
  assert.deepEqual(delivery, { ok: true, reference: "email_1" });
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.equal(calls[0]!.headers.authorization, "Bearer re_test");
  assert.equal(calls[0]!.body.from, "PriceLens <hello@example.com>");
  assert.deepEqual(calls[0]!.body.to, ["reader@example.com"]);
  assert.equal(calls[0]!.body.subject, "Big onion down 12%");
  assert.equal(calls[0]!.body.reply_to, "owner@example.com");
  assert.ok(String(calls[0]!.body.html).includes("<h1"));
  assert.equal(calls[0]!.body.headers, undefined, "no custom headers unless the target asks");
  // A newsletter target carries its list headers through; anything that is not a clean header is dropped.
  await email.send({ kind: "email", address: "reader@example.com", meta: { headers: { "List-Unsubscribe": "<mailto:hello@example.com>, <https://price.example/u?token=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-Bad": "a\r\nb", "": "x", "X-Number": 4 } } }, short);
  assert.deepEqual(calls[1]!.body.headers, { "List-Unsubscribe": "<mailto:hello@example.com>, <https://price.example/u?token=x>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  const rejected = createEmailChannel({ apiKey: "bad", from: "x <x@example.com>", fetch: recorder(() => new Response("API key is invalid", { status: 401 })).request });
  const failed = await rejected.send({ kind: "email", address: "reader@example.com" }, short);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.retryable, false);
    assert.equal(failed.gone, false);
    assert.match(failed.error, /RESEND_HTTP_401/u);
  }
  const malformed = await email.send({ kind: "email", address: "not-an-address" }, short);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.gone, true);
  assert.equal(email.describe({ kind: "email", address: "reader@example.com" }), "email:re…@example.com");
});

test("the registry has webhook channels always and secret-bearing ones only when configured", async () => {
  const bare = createChannels();
  assert.deepEqual([...bare.keys()].sort(), ["discord", "slack"]);
  const full = createChannels({ telegram: { token: "t" }, email: { apiKey: "k", from: "a <a@example.com>" }, webpush: { vapid: generateVapidKeys(), subject: "mailto:owner@example.com" } });
  assert.deepEqual([...full.keys()].sort(), ["discord", "email", "slack", "telegram", "webpush"]);
  const missing = await sendDirect(bare, { kind: "telegram", address: "1" }, short);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /CHANNEL_UNAVAILABLE: telegram/u);
});
