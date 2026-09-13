import assert from "node:assert/strict";
import test from "node:test";

import type { FeedbackItem } from "../src/feedback.ts";
import { createOwnerNotifier, feedbackMessage } from "../src/notify.ts";

const item: FeedbackItem = { id: "fb_1", kind: "bug", message: "The chart shows nothing for coconut", email: "someone@example.com", page: "https://price.prabhavalabs.com/p/product_coconut", user_agent: "test", status: "new", created_at: "2026-09-07T05:00:00.000Z", updated_at: "2026-09-07T05:00:00.000Z" };

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function recorder(status = 200) {
  const calls: Call[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown>, headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify({ id: "sent_1" }), { status });
  }) as typeof fetch;
  return { calls, request };
}

test("without any address nothing is sent and nothing fails", async () => {
  const { calls, request } = recorder();
  const owner = createOwnerNotifier({}, request);
  assert.equal(owner.configured, false);
  assert.deepEqual(await owner.notify(feedbackMessage(item)), []);
  assert.equal(calls.length, 0);
});

test("a feedback item reads as a titled message with its origin as key-value lines", () => {
  const note = feedbackMessage(item);
  assert.equal(note.title, "[PriceLens] Bug report: The chart shows nothing for coconut");
  assert.equal(note.summary, item.message);
  assert.equal(note.severity, "alert");
  assert.deepEqual(note.sections[0]!.lines.map((line) => line.text), ["Page", "From", "Browser", "Received", "Id"]);
  assert.equal(note.dedupe_key, "feedback:fb_1");
  const long = feedbackMessage({ ...item, kind: "feedback", message: "x".repeat(80), email: null, page: null });
  assert.ok(long.title.endsWith("…"));
  assert.equal(long.severity, "good");
  assert.equal(long.sections[0]!.lines[1]!.value, "anonymous");
});

test("the Discord webhook gets one embed with the message and its origin, mentions disabled", async () => {
  const { calls, request } = recorder();
  const owner = createOwnerNotifier({ LPL_FEEDBACK_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123/abc_DEF-ghi" }, request);
  assert.equal(owner.configured, true);
  assert.deepEqual(owner.targets, ["discord:webhook abc…ghi"]);
  const results = await owner.notify(feedbackMessage(item));
  assert.equal(results.length, 1);
  assert.deepEqual(results[0]!.delivery, { ok: true, reference: "sent_1" });
  assert.equal(calls[0]!.url, "https://discord.com/api/webhooks/123/abc_DEF-ghi?wait=true");
  const body = calls[0]!.body as { username: string; allowed_mentions: { parse: string[] }; embeds: Array<{ title: string; description: string; color: number; fields: Array<{ name: string; value: string }> }> };
  assert.equal(body.username, "PriceLens");
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.embeds.length, 1);
  assert.match(body.embeds[0]!.title, /Bug report/u);
  assert.equal(body.embeds[0]!.description, item.message);
  assert.deepEqual(body.embeds[0]!.fields.map((field) => field.name), ["Page", "From", "Browser", "Received", "Id"]);
});

test("mail goes through Resend to the owner's address with the reader as reply-to; a webhook that is not Discord's is refused", async () => {
  const { calls, request } = recorder();
  const owner = createOwnerNotifier({ LPL_RESEND_API_KEY: "re_test_123", LPL_FEEDBACK_EMAIL_TO: "owner@example.com", LPL_MAIL_FROM: "PriceLens <feedback@example.com>", LPL_FEEDBACK_DISCORD_WEBHOOK: "https://example.com/hook" }, request);
  assert.deepEqual(owner.targets, ["discord:webhook …", "email:ow…@example.com"]);
  const results = await owner.notify(feedbackMessage(item), { replyTo: item.email ?? undefined });
  assert.equal(results[0]!.delivery.ok, false, "not a Discord webhook URL");
  assert.deepEqual(results[1]!.delivery, { ok: true, reference: "sent_1" });
  assert.equal(calls.length, 1, "only the mail was attempted");
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.equal(calls[0]!.headers.authorization, "Bearer re_test_123");
  const body = calls[0]!.body as { from: string; to: string[]; subject: string; text: string; html: string; reply_to: string };
  assert.equal(body.from, "PriceLens <feedback@example.com>");
  assert.deepEqual(body.to, ["owner@example.com"]);
  assert.equal(body.subject, "[PriceLens] Bug report: The chart shows nothing for coconut");
  assert.match(body.text, /Page: https:\/\/price\.prabhavalabs\.com\/p\/product_coconut/u);
  assert.ok(body.html.includes("<h1"));
  assert.equal(body.reply_to, "someone@example.com");

  // No key, no mail target, even with an address.
  assert.equal(createOwnerNotifier({ LPL_FEEDBACK_EMAIL_TO: "owner@example.com" }, request).configured, false);
});

test("a failed post is reported, not thrown", async () => {
  const { request } = recorder(429);
  const owner = createOwnerNotifier({ LPL_FEEDBACK_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123/abc" }, request);
  const [result] = await owner.notify(feedbackMessage(item));
  assert.equal(result!.delivery.ok, false);
  if (!result!.delivery.ok) {
    assert.match(result!.delivery.error, /DISCORD_HTTP_429/u);
    assert.equal(result!.delivery.retryable, true);
  }
});
