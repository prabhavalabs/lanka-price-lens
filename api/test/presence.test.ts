import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { createApp } from "../src/app.ts";
import { feedbackMessage } from "../src/mail.ts";
import { Presence } from "../src/presence.ts";

test("presence counts beats within the window and forgets the rest", () => {
  const presence = new Presence(60_000, 3);
  assert.equal(presence.beat("tab-aaaaaaaa", 0), 1);
  assert.equal(presence.beat("tab-bbbbbbbb", 1_000), 2);
  assert.equal(presence.beat("tab-aaaaaaaa", 30_000), 2, "the same tab counts once");
  assert.equal(presence.count(70_000), 1, "the tab that fell silent for over a minute is gone");
  assert.equal(presence.beat("tab-cccccccc", 70_000), 2);
  assert.equal(presence.beat("tab-dddddddd", 70_000), 3);
  assert.equal(presence.beat("tab-eeeeeeee", 70_000), 3, "over capacity a new id is not counted");
});

test("public presence and config routes answer without sign-in and are never cached", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const app = createApp(database, undefined, undefined, { presence: new Presence() });
    const bad = await app.request("http://localhost/v1/public/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "x" }) });
    assert.equal(bad.status, 400);
    const first = await app.request("http://localhost/v1/public/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "3f2a9c1e-tab-one" }) });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.deepEqual(((await first.json()) as { payload: { online: number } }).payload, { online: 1 });
    await app.request("http://localhost/v1/public/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "3f2a9c1e-tab-two" }) });
    const count = (await (await app.request("http://localhost/v1/public/presence")).json()) as { payload: { online: number } };
    assert.equal(count.payload.online, 2);

    const config = await app.request("http://localhost/v1/public/config");
    assert.equal(config.status, 200);
    assert.deepEqual(((await config.json()) as { payload: unknown }).payload, { analytics: { ga_measurement_id: null } }, "no analytics id without the setting");
  } finally {
    database.close();
  }
});

test("a feedback message reads well in the owner's inbox", () => {
  const message = feedbackMessage({ id: "feedback_1", kind: "bug", message: "The chart does not load on my phone.", email: "reader@example.com", page: "https://price.example/p/product_potato", user_agent: "TestBrowser/1.0", status: "new", created_at: "2026-09-06T01:00:00.000Z", updated_at: "2026-09-06T01:00:00.000Z" });
  assert.equal(message.subject, "[PriceLens] Bug report: The chart does not load on my phone.");
  assert.match(message.text, /Page: https:\/\/price\.example\/p\/product_potato/u);
  assert.equal(message.replyTo, "reader@example.com");
  const anonymous = feedbackMessage({ id: "feedback_2", kind: "feedback", message: "x".repeat(80), email: null, page: null, user_agent: null, status: "new", created_at: "2026-09-06T01:00:00.000Z", updated_at: "2026-09-06T01:00:00.000Z" });
  assert.ok(anonymous.subject.endsWith("…"));
  assert.equal(anonymous.replyTo, undefined);
});

test("the mailer posts to Resend with the owner's address and stays silent when unconfigured", async () => {
  const { createMailer } = await import("../src/mail.ts");
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ id: "email_1" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const silent = createMailer({}, request);
  assert.equal(silent.configured, false);
  await silent.send({ subject: "x", text: "y" });
  assert.equal(calls.length, 0, "nothing is sent without a key and an address");

  const mailer = createMailer({ LPL_RESEND_API_KEY: "re_test_123", LPL_FEEDBACK_EMAIL_TO: "owner@example.com", LPL_MAIL_FROM: "PriceLens <feedback@example.com>" }, request);
  assert.equal(mailer.configured, true);
  await mailer.send({ subject: "[PriceLens] Bug report: x", text: "body", replyTo: "reader@example.com" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.authorization, "Bearer re_test_123");
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { from: "PriceLens <feedback@example.com>", to: ["owner@example.com"], subject: "[PriceLens] Bug report: x", text: "body", reply_to: "reader@example.com" });

  const failing = createMailer({ LPL_RESEND_API_KEY: "re_test_123", LPL_FEEDBACK_EMAIL_TO: "owner@example.com" }, (async () => new Response("bad key", { status: 401 })) as typeof fetch);
  await assert.rejects(failing.send({ subject: "s", text: "t" }), /RESEND_HTTP_401/u);
});
