import assert from "node:assert/strict";
import test from "node:test";

import { createAccountMailer, defaultAccountMailFrom, renderAccountMail, type AccountMailInput, type AccountMailKind } from "../src/account/mail.ts";

type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> };

function recorder(respond: (call: Call) => Response = () => new Response(null, { status: 202, headers: { "x-message-id": "sg_1" } })) {
  const calls: Call[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}, headers: (init?.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, request };
}

const link = "https://price.example/account/verify?token=abcdefghijklmnopqrstuvwxyz";

const samples: { [K in AccountMailKind]: { input: AccountMailInput<K>; subject: string; button: string | null } } = {
  verifyEmail: { input: { to: "amal@example.com", name: "Amal", link }, subject: "Confirm your email address", button: "Confirm my email" },
  welcome: { input: { to: "amal@example.com", name: "Amal", link: "https://price.example/" }, subject: "Your PriceLens account is ready", button: "Open PriceLens" },
  resetPassword: { input: { to: "amal@example.com", name: "Amal", link: "https://price.example/account/reset?token=abcdefghijklmnopqrstuvwxyz", expiresMinutes: 60 }, subject: "Reset your PriceLens password", button: "Choose a new password" },
  passwordChanged: { input: { to: "amal@example.com", name: "Amal", when: "13 September 2026 at 09:15", link: "https://price.example/account/forgot" }, subject: "Your PriceLens password was changed", button: "Reset my password" },
  changeEmail: { input: { to: "new@example.com", name: "Amal", link: "https://price.example/account/confirm-email?token=abcdefghijklmnopqrstuvwxyz", newEmail: "new@example.com" }, subject: "Confirm your new email address", button: "Confirm this address" },
  emailChanged: { input: { to: "amal@example.com", name: "Amal", newEmail: "new@example.com", link: "https://price.example/account/forgot" }, subject: "The email address on your PriceLens account was changed", button: "Secure my account" },
  accountDeleted: { input: { to: "amal@example.com", name: "Amal" }, subject: "Your PriceLens account was deleted", button: null },
};

test("every template has a subject, addresses the person by name, shows the button and writes its link out in html and text", () => {
  for (const kind of Object.keys(samples) as AccountMailKind[]) {
    const sample = samples[kind];
    const rendered = renderAccountMail(kind, sample.input as never);
    assert.equal(rendered.subject, sample.subject, kind);
    assert.ok(rendered.subject.length <= 200);
    assert.ok(rendered.html.includes("Amal"), `${kind} html greets by name`);
    assert.ok(rendered.text.includes("Amal"), `${kind} text greets by name`);
    const url = "link" in sample.input ? sample.input.link : null;
    if (sample.button && url) {
      assert.ok(rendered.html.includes(`>${sample.button}</a>`), `${kind} html has the button`);
      assert.ok(rendered.html.includes(`href="${url}"`), `${kind} html links the button`);
      assert.ok(rendered.html.includes(`>${url}</a>`), `${kind} html writes the link out`);
      assert.ok(rendered.text.includes(`${sample.button}: ${url}`), `${kind} text carries the link`);
    } else {
      assert.ok(!rendered.html.includes("copy this link"), `${kind} has no button`);
    }
    // The one layout: doctype, a 600 px table, the mark (the only image), the footer with the reply address, and nothing else that must load.
    assert.ok(rendered.html.startsWith("<!doctype html>"));
    assert.ok(rendered.html.includes('width="600"'));
    assert.ok(rendered.html.includes('src="https://price.prabhavalabs.com/mark.png"'));
    assert.ok(rendered.html.includes("You're getting this email"));
    assert.ok(rendered.html.includes("mailto:hello@prabhavalabs.com"));
    assert.equal(rendered.html.match(/<img\b/gu)?.length, 1, "the mark is the only image, no tracking pixels");
    assert.ok(!/<link\b|<script\b/u.test(rendered.html), "no external resources");
    assert.ok(rendered.text.includes("Reply to this email or write to hello@prabhavalabs.com"));
    assert.ok(!/<[a-z]/u.test(rendered.text), `${kind} text has no markup`);
  }
});

test("templates say what matters: the reset window, the new address, when the password changed", () => {
  const reset = renderAccountMail("resetPassword", samples.resetPassword.input);
  assert.ok(reset.text.includes("The link works for 60 minutes."));
  const change = renderAccountMail("changeEmail", samples.changeEmail.input);
  assert.ok(change.html.includes("move your PriceLens account to new@example.com"));
  const changed = renderAccountMail("emailChanged", samples.emailChanged.input);
  assert.ok(changed.text.includes("is now new@example.com"));
  const password = renderAccountMail("passwordChanged", samples.passwordChanged.input);
  assert.ok(password.text.includes("changed on 13 September 2026 at 09:15"));
  const welcome = renderAccountMail("welcome", samples.welcome.input);
  assert.ok(welcome.html.includes("Welcome to PriceLens, Amal</h1>"));
  const deleted = renderAccountMail("accountDeleted", samples.accountDeleted.input);
  assert.ok(deleted.html.includes("welcome back any time"));
  // The footer's reply address follows the sender.
  const branded = renderAccountMail("welcome", samples.welcome.input, { replyTo: "team@example.com" });
  assert.ok(branded.html.includes("mailto:team@example.com"));
  assert.ok(branded.text.includes("write to team@example.com"));
});

test("html escapes what the person typed and the link's query; text keeps them as they are", () => {
  const name = '<b>Amal</b> & "friends"';
  const tricky = "https://price.example/account/reset?token=abc&lang=si";
  const rendered = renderAccountMail("resetPassword", { to: "amal@example.com", name, link: tricky, expiresMinutes: 30 });
  assert.ok(!rendered.html.includes("<b>Amal</b>"));
  assert.ok(rendered.html.includes("&lt;b&gt;Amal&lt;/b&gt; &amp; &quot;friends&quot;"));
  assert.ok(rendered.html.includes('href="https://price.example/account/reset?token=abc&amp;lang=si"'));
  assert.ok(!rendered.html.includes("token=abc&lang"));
  assert.ok(rendered.text.includes(name));
  assert.ok(rendered.text.includes(`Choose a new password: ${tricky}`));
  const address = renderAccountMail("changeEmail", { to: "x@example.com", name: "Amal", link: tricky, newEmail: "<script>@example.com" });
  assert.ok(address.html.includes("&lt;script&gt;@example.com"));
  assert.ok(!address.html.includes("<script>"));
});

test("without a key the mailer is unconfigured, says so once, and answers every send with a failure", async () => {
  const { calls, request } = recorder();
  const lines: string[] = [];
  const mailer = createAccountMailer({}, request, { log: (line) => lines.push(line) });
  assert.equal(mailer.configured, false);
  assert.equal(mailer.describe(), "not configured");
  assert.deepEqual(await mailer.verifyEmail(samples.verifyEmail.input), { ok: false, error: "MAIL_NOT_CONFIGURED" });
  assert.deepEqual(await mailer.accountDeleted(samples.accountDeleted.input), { ok: false, error: "MAIL_NOT_CONFIGURED" });
  assert.equal(calls.length, 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /LPL_RESEND_API_KEY/u);
  assert.match(lines[0]!, /am…@example\.com/u);
  assert.ok(!lines[0]!.includes("amal@example.com"), "the address is masked in the log");
});

test("with a SendGrid key mail goes to SendGrid as the branded html and text, from the configured sender", async () => {
  const { calls, request } = recorder();
  const mailer = createAccountMailer({ LPL_SENDGRID_API_KEY: "SG.secret-key-value", LPL_MAIL_FROM: "PriceLens <hello@prabhavalabs.com>" }, request);
  assert.equal(mailer.configured, true);
  assert.equal(mailer.describe(), "sendgrid as PriceLens <hello@prabhavalabs.com> (key SG.s…alue)");
  const result = await mailer.verifyEmail(samples.verifyEmail.input);
  assert.deepEqual(result, { ok: true, reference: "sg_1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.sendgrid.com/v3/mail/send");
  assert.equal(calls[0]!.headers.authorization, "Bearer SG.secret-key-value");
  const body = calls[0]!.body as { personalizations: Array<{ to: Array<{ email: string }> }>; from: { email: string; name: string }; subject: string; content: Array<{ type: string; value: string }>; tracking_settings: { click_tracking: { enable: boolean } } };
  assert.deepEqual(body.personalizations, [{ to: [{ email: "amal@example.com" }] }]);
  assert.deepEqual(body.from, { email: "hello@prabhavalabs.com", name: "PriceLens" });
  assert.equal(body.subject, "Confirm your email address");
  const expected = renderAccountMail("verifyEmail", samples.verifyEmail.input);
  assert.equal(body.content[0]!.value, expected.text);
  assert.equal(body.content[1]!.value, expected.html);
  assert.ok(body.content[1]!.value.includes(">Confirm my email</a>"));
  assert.equal(body.tracking_settings.click_tracking.enable, false);
});

test("with a Resend key mail goes to Resend from the default sender; Resend wins when both keys are set", async () => {
  const resend = recorder(() => new Response(JSON.stringify({ id: "re_1" })));
  const mailer = createAccountMailer({ LPL_RESEND_API_KEY: "re_local" }, resend.request);
  assert.equal(mailer.configured, true);
  assert.equal(mailer.describe(), `resend as ${defaultAccountMailFrom} (key …)`);
  assert.deepEqual(await mailer.welcome(samples.welcome.input), { ok: true, reference: "re_1" });
  assert.equal(resend.calls[0]!.url, "https://api.resend.com/emails");
  assert.equal(resend.calls[0]!.body.from, "PriceLens <hello@prabhavalabs.com>");
  assert.deepEqual(resend.calls[0]!.body.to, ["amal@example.com"]);
  assert.equal(resend.calls[0]!.body.subject, "Your PriceLens account is ready");
  assert.equal(resend.calls[0]!.body.html, renderAccountMail("welcome", samples.welcome.input).html);

  const both = recorder(() => new Response(JSON.stringify({ id: "re_2" })));
  await createAccountMailer({ LPL_RESEND_API_KEY: "re_local", LPL_SENDGRID_API_KEY: "SG.prod" }, both.request).welcome(samples.welcome.input);
  assert.equal(both.calls[0]!.url, "https://api.resend.com/emails");
});

test("delivery problems come back as results, never as exceptions", async () => {
  const offline = createAccountMailer({ LPL_SENDGRID_API_KEY: "SG.k" }, (async () => { throw new Error("ECONNRESET"); }) as typeof fetch);
  assert.deepEqual(await offline.resetPassword(samples.resetPassword.input), { ok: false, error: "SENDGRID_NETWORK: ECONNRESET" });
  const refused = createAccountMailer({ LPL_SENDGRID_API_KEY: "SG.k" }, recorder(() => new Response(JSON.stringify({ errors: [{ message: "The provided authorization grant is invalid, expired, or revoked" }] }), { status: 401 })).request);
  const result = await refused.passwordChanged(samples.passwordChanged.input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /^SENDGRID_HTTP_401/u);
  const invalid = createAccountMailer({ LPL_SENDGRID_API_KEY: "SG.k" }, recorder().request);
  assert.deepEqual(await invalid.emailChanged({ ...samples.emailChanged.input, to: "not an address" }), { ok: false, error: "EMAIL_ADDRESS_INVALID" });
});
