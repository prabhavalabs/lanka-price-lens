import assert from "node:assert/strict";
import test from "node:test";

import { createChannels, createEmailChannel, createSendGridChannel, message, parseMailbox } from "../src/index.ts";

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

type SendGridBody = {
  personalizations: Array<{ to: Array<{ email: string }> }>;
  from: { email: string; name?: string };
  reply_to?: { email: string; name?: string };
  subject: string;
  content: Array<{ type: string; value: string }>;
  tracking_settings: Record<string, unknown>;
  mail_settings: Record<string, unknown>;
};

const note = message({ title: "Confirm your email address", summary: "Press the button to confirm that this address is yours.", actions: [{ label: "Confirm my email", url: "https://price.example/account/verify?token=abc" }] });

test("sendgrid posts one personalization with text then html, tracking off, and reads the message id header", async () => {
  const { calls, request } = recorder(() => new Response(null, { status: 202, headers: { "X-Message-Id": "msg_123" } }));
  const channel = createSendGridChannel({ apiKey: "SG.test", from: "PriceLens <hello@example.com>", fetch: request });
  assert.equal(channel.kind, "email");
  const delivery = await channel.send({ kind: "email", address: "reader@example.com", meta: { reply_to: "owner@example.com" } }, note);
  assert.deepEqual(delivery, { ok: true, reference: "msg_123" });
  assert.equal(calls[0]!.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(calls[0]!.headers.authorization, "Bearer SG.test");
  assert.equal(calls[0]!.headers["content-type"], "application/json");
  const body = calls[0]!.body as SendGridBody;
  assert.deepEqual(body.personalizations, [{ to: [{ email: "reader@example.com" }] }]);
  assert.deepEqual(body.from, { email: "hello@example.com", name: "PriceLens" });
  assert.deepEqual(body.reply_to, { email: "owner@example.com" });
  assert.equal(body.subject, "Confirm your email address");
  assert.deepEqual(body.content.map((part) => part.type), ["text/plain", "text/html"]);
  assert.ok(body.content[0]!.value.includes("Confirm my email: https://price.example/account/verify?token=abc"));
  assert.ok(body.content[1]!.value.includes("<h1"));
  assert.deepEqual(body.tracking_settings, { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } });
  assert.deepEqual(body.mail_settings, { sandbox_mode: { enable: false } });
  assert.equal(channel.describe({ kind: "email", address: "reader@example.com" }), "email:re…@example.com");

  // Without a reply address none is sent, and an accepted mail without the header has no reference.
  const bare = recorder(() => new Response(null, { status: 202 }));
  const plain = await createSendGridChannel({ apiKey: "k", from: "hello@example.com", fetch: bare.request }).send({ kind: "email", address: "reader@example.com" }, note);
  assert.deepEqual(plain, { ok: true, reference: null });
  const sent = bare.calls[0]!.body as SendGridBody;
  assert.equal(sent.reply_to, undefined);
  assert.deepEqual(sent.from, { email: "hello@example.com" });
});

test("sendgrid: rate limits and outages are retried, a refused recipient is gone, a bad key is neither", async () => {
  const limited = createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: recorder(() => new Response('{"errors":[{"message":"too many requests"}]}', { status: 429, headers: { "retry-after": "30" } })).request });
  const retry = await limited.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(retry.ok, false);
  if (!retry.ok) {
    assert.equal(retry.retryable, true);
    assert.equal(retry.gone, false);
    assert.equal(retry.retryAfterMs, 30_000);
    assert.match(retry.error, /^SENDGRID_HTTP_429: /u);
  }

  const down = createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: recorder(() => new Response("upstream unavailable", { status: 503 })).request });
  const outage = await down.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(outage.ok, false);
  if (!outage.ok) {
    assert.equal(outage.retryable, true);
    assert.equal(outage.gone, false);
  }

  const refused = createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: recorder(() => new Response(JSON.stringify({ errors: [{ message: "The to email does not contain a valid address.", field: "personalizations.0.to.0.email" }] }), { status: 400 })).request });
  const gone = await refused.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(gone.ok, false);
  if (!gone.ok) {
    assert.equal(gone.gone, true);
    assert.equal(gone.retryable, false);
    assert.match(gone.error, /SENDGRID_HTTP_400: .*does not contain a valid address/u);
  }

  const ourMistake = createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: recorder(() => new Response(JSON.stringify({ errors: [{ message: "The from email does not contain a valid address.", field: "from.email" }] }), { status: 400 })).request });
  const fromBad = await ourMistake.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(fromBad.ok, false);
  if (!fromBad.ok) {
    assert.equal(fromBad.gone, false, "a bad sender is our problem, not the recipient's");
    assert.equal(fromBad.retryable, false);
  }

  const rejected = createSendGridChannel({ apiKey: "bad", from: "a@example.com", fetch: recorder(() => new Response(JSON.stringify({ errors: [{ message: "The provided authorization grant is invalid, expired, or revoked" }] }), { status: 401 })).request });
  const failed = await rejected.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.retryable, false);
    assert.equal(failed.gone, false);
    assert.match(failed.error, /^SENDGRID_HTTP_401/u);
  }

  const offline = createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: (async () => { throw new Error("ECONNRESET"); }) as typeof fetch });
  const network = await offline.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(network.ok, false);
  if (!network.ok) {
    assert.equal(network.retryable, true);
    assert.equal(network.error, "SENDGRID_NETWORK: ECONNRESET");
  }

  const malformed = await limited.send({ kind: "email", address: "not-an-address" }, note);
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.gone, true);
});

test("both email channels pass a ready-made subject, html, and text through unchanged", async () => {
  const html = "<!doctype html><html><body><table><tr><td>Branded</td></tr></table></body></html>";
  const text = "Branded text\n\nhttps://price.example/x";
  const target = { kind: "email" as const, address: "reader@example.com", meta: { subject: "  Custom subject  ", html, text } };

  const sendgrid = recorder(() => new Response(null, { status: 202 }));
  await createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: sendgrid.request }).send(target, note);
  const sent = sendgrid.calls[0]!.body as SendGridBody;
  assert.equal(sent.subject, "Custom subject");
  assert.deepEqual(sent.content, [
    { type: "text/plain", value: text },
    { type: "text/html", value: html },
  ]);

  const resend = recorder(() => new Response(JSON.stringify({ id: "email_1" })));
  await createEmailChannel({ apiKey: "k", from: "a@example.com", fetch: resend.request }).send(target, note);
  assert.equal(resend.calls[0]!.body.subject, "Custom subject");
  assert.equal(resend.calls[0]!.body.html, html);
  assert.equal(resend.calls[0]!.body.text, text);

  // Blank overrides fall back to the rendered message.
  const fallback = recorder(() => new Response(null, { status: 202 }));
  await createSendGridChannel({ apiKey: "k", from: "a@example.com", fetch: fallback.request }).send({ ...target, meta: { subject: " ", html: "   ", text: "" } }, note);
  const rendered = fallback.calls[0]!.body as SendGridBody;
  assert.equal(rendered.subject, "Confirm your email address");
  assert.ok(rendered.content[0]!.value.startsWith("Confirm your email address"));
  assert.ok(rendered.content[1]!.value.includes("<h1"));
});

test("the registry picks SendGrid by provider and Resend otherwise; the from line parses with or without a name", async () => {
  const sendgrid = recorder(() => new Response(null, { status: 202, headers: { "x-message-id": "1" } }));
  const withSendGrid = createChannels({ email: { provider: "sendgrid", apiKey: "k", from: "PriceLens <hello@example.com>" }, fetch: sendgrid.request });
  assert.deepEqual(await withSendGrid.get("email")!.send({ kind: "email", address: "reader@example.com" }, note), { ok: true, reference: "1" });
  assert.equal(sendgrid.calls[0]!.url, "https://api.sendgrid.com/v3/mail/send");

  const resend = recorder(() => new Response(JSON.stringify({ id: "re_1" })));
  const withResend = createChannels({ email: { apiKey: "k", from: "PriceLens <hello@example.com>" }, fetch: resend.request });
  assert.deepEqual(await withResend.get("email")!.send({ kind: "email", address: "reader@example.com" }, note), { ok: true, reference: "re_1" });
  assert.equal(resend.calls[0]!.url, "https://api.resend.com/emails");

  const explicit = recorder(() => new Response(JSON.stringify({ id: "re_2" })));
  await createChannels({ email: { provider: "resend", apiKey: "k", from: "a@example.com" }, fetch: explicit.request }).get("email")!.send({ kind: "email", address: "reader@example.com" }, note);
  assert.equal(explicit.calls[0]!.url, "https://api.resend.com/emails");

  assert.deepEqual(parseMailbox("PriceLens <hello@example.com>"), { email: "hello@example.com", name: "PriceLens" });
  assert.deepEqual(parseMailbox('"Price Lens" <hello@example.com>'), { email: "hello@example.com", name: "Price Lens" });
  assert.deepEqual(parseMailbox(" hello@example.com "), { email: "hello@example.com" });
  assert.deepEqual(parseMailbox("<hello@example.com>"), { email: "hello@example.com" });
});
