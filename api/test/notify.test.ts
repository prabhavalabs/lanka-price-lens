import assert from "node:assert/strict";
import test from "node:test";

import type { FeedbackItem } from "../src/feedback.ts";
import { createNotifier, feedbackNote } from "../src/notify.ts";

const item: FeedbackItem = { id: "fb_1", kind: "bug", message: "The chart shows nothing for coconut", email: "someone@example.com", page: "https://price.prabhavalabs.com/p/product_coconut", user_agent: "test", status: "new", created_at: "2026-09-07T05:00:00.000Z" } as FeedbackItem;

test("without a webhook nothing is sent and nothing fails", async () => {
  let calls = 0;
  const notifier = createNotifier({}, async () => { calls += 1; return new Response("ok"); });
  assert.equal(notifier.configured, false);
  await notifier.post(feedbackNote(item));
  assert.equal(calls, 0);
});

test("a webhook that is not Discord's is ignored", () => {
  assert.equal(createNotifier({ LPL_FEEDBACK_DISCORD_WEBHOOK: "https://example.com/hook" }).configured, false);
});

test("a feedback item becomes one embed with the message and its origin, mentions disabled", async () => {
  const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
  const notifier = createNotifier({ LPL_FEEDBACK_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123/abc_DEF-ghi" }, async (url, init) => { seen.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> }); return new Response("{}", { status: 200 }); });
  assert.equal(notifier.configured, true);
  await notifier.post(feedbackNote(item));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.url, "https://discord.com/api/webhooks/123/abc_DEF-ghi?wait=true");
  const body = seen[0]!.body as { username: string; allowed_mentions: { parse: string[] }; embeds: Array<{ title: string; description: string; color: number; fields: Array<{ name: string; value: string }> }> };
  assert.equal(body.username, "PriceLens");
  assert.deepEqual(body.allowed_mentions, { parse: [] });
  assert.equal(body.embeds.length, 1);
  assert.match(body.embeds[0]!.title, /Bug report/u);
  assert.equal(body.embeds[0]!.description, item.message);
  assert.deepEqual(body.embeds[0]!.fields.map((field) => field.name), ["Page", "From", "Received", "Id"]);
});

test("a failed post surfaces the status so the caller can log it", async () => {
  const notifier = createNotifier({ LPL_FEEDBACK_DISCORD_WEBHOOK: "https://discord.com/api/webhooks/123/abc" }, async () => new Response("rate limited", { status: 429 }));
  await assert.rejects(notifier.post(feedbackNote(item)), /DISCORD_HTTP_429/u);
});
