import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { readAccount, requireVerified, type AccountEnv } from "../src/account/middleware.ts";
import { accountRoutes, type AccountRateLimits } from "../src/account/routes.ts";
import { createAccountService } from "../src/account/service.ts";
import { createAccountStore } from "../src/account/store.ts";
import { defaultAccountConfig, type AccountConfig, type AccountMailer, type MailResult } from "../src/account/types.ts";
import { RateLimiter } from "../src/feedback.ts";

type Answer<T = unknown> = { success: boolean; message: string; payload: T; code?: string; meta: { request_id: string } };
type Profile = { id: string; email: string; email_verified: boolean; display_name: string; locale: string; preferences: Record<string, boolean>; identities: string[]; has_password: boolean };
type Sent = { kind: string; to: string; name: string; link: string | null; newEmail: string | null };

/** Records every mail instead of sending it; `fail` makes each send report a failure. */
function mailerDouble() {
  const sent: Sent[] = [];
  const state = { fail: false };
  const record = (kind: string) => async (input: { to: string; name: string; link?: string; newEmail?: string }): Promise<MailResult> => {
    sent.push({ kind, to: input.to, name: input.name, link: input.link ?? null, newEmail: input.newEmail ?? null });
    return state.fail ? { ok: false, error: "SendGrid said no" } : { ok: true, reference: `ref_${sent.length}` };
  };
  const mailer: AccountMailer = {
    configured: true,
    describe: () => "test double",
    verifyEmail: record("verifyEmail"),
    welcome: record("welcome"),
    resetPassword: record("resetPassword"),
    passwordChanged: record("passwordChanged"),
    changeEmail: record("changeEmail"),
    emailChanged: record("emailChanged"),
    accountDeleted: record("accountDeleted"),
  };
  return { mailer, sent, state, tokenOf: (mail: Sent) => new URL(mail.link!).searchParams.get("token")! };
}

function harness(options: { rateLimits?: AccountRateLimits; secureCookies?: boolean } = {}) {
  const database = openOperationalDatabase(":memory:");
  const store = createAccountStore(database);
  const mail = mailerDouble();
  const config: AccountConfig = { ...defaultAccountConfig, siteOrigin: "https://price.example", google: null, stateSecret: "test-secret", secureCookies: options.secureCookies ?? false };
  const logs: Array<Record<string, unknown>> = [];
  const service = createAccountService({ store, mailer: mail.mailer, config, log: (line) => logs.push(line) });
  const app = new Hono<AccountEnv>();
  app.use("*", requestId());
  // Generous budgets by default so the flows can sign in as often as they like; the rate-limit test passes its own.
  const generous = () => new RateLimiter(1_000, 60_000);
  app.route("/v1/account", accountRoutes({ store, service, config, rateLimits: { register: generous(), login: generous(), forgot: generous(), resend: generous(), ...options.rateLimits } }));
  app.get("/v1/test/verified-only", requireVerified(store, config), (context) => context.json({ email: context.get("account").email }));
  app.get("/v1/test/optional", readAccount(store, config), (context) => context.json({ email: context.get("account")?.email ?? null }));

  const call = async (path: string, init: { method?: string; body?: unknown; cookie?: string | undefined; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "TestBrowser/1.0", "x-forwarded-for": "203.0.113.7", ...init.headers };
    if (init.cookie) headers.cookie = init.cookie;
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    const response = await app.request(`http://localhost${path}`, { method, headers, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
    const text = await response.text();
    const setCookie = response.headers.get("set-cookie");
    const match = setCookie?.match(/lpl_session=([^;]*)/u);
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Answer<Profile>, cookie: match?.[1] ? `lpl_session=${match[1]}` : undefined, setCookie, headers: response.headers };
  };
  const register = async (email: string, password = "correct horse battery staple", display_name = "Nimal") => {
    const response = await call("/v1/account/register", { body: { email, password, display_name } });
    assert.equal(response.status, 201, response.body?.message);
    return response;
  };
  return { database, store, mail, config, service, app, call, register, logs, close: () => database.close() };
}

test("register signs in, mails a verification link, and /me answers the profile", async () => {
  const h = harness();
  try {
    const registered = await h.register("Nimal@Example.com");
    assert.equal(registered.body.success, true);
    assert.equal(registered.body.payload.email, "nimal@example.com", "the address is normalised by the shared schema");
    assert.deepEqual({ verified: registered.body.payload.email_verified, password: registered.body.payload.has_password, identities: registered.body.payload.identities }, { verified: false, password: true, identities: [] });
    assert.ok(registered.cookie, "a session cookie is set");
    assert.match(registered.setCookie!, /HttpOnly/u);
    assert.match(registered.setCookie!, /SameSite=Lax/u);
    assert.match(registered.setCookie!, /Path=\//u);
    assert.match(registered.setCookie!, /Max-Age=2592000/u, "registration starts a thirty-day session");
    assert.doesNotMatch(registered.setCookie!, /Secure/u, "no Secure flag when the config says so (local http)");

    const me = await h.call("/v1/account/me", { cookie: registered.cookie });
    assert.equal(me.status, 200);
    assert.equal(me.body.payload.id, registered.body.payload.id);
    assert.equal(me.body.payload.display_name, "Nimal");
    assert.deepEqual(me.body.payload.preferences, { notify_email: true, notify_digest: false, notify_alerts: false });

    assert.equal(h.mail.sent.length, 1);
    assert.equal(h.mail.sent[0]!.kind, "verifyEmail");
    assert.equal(h.mail.sent[0]!.to, "nimal@example.com");
    assert.match(h.mail.sent[0]!.link!, /^https:\/\/price\.example\/account\/verify\?token=[A-Za-z0-9_-]{40,}$/u);

    const stored = h.database.prepare("SELECT password_hash FROM account").get() as { password_hash: string };
    assert.match(stored.password_hash, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/u, "the same scrypt form as the admin login");

    const duplicate = await h.call("/v1/account/register", { body: { email: "NIMAL@example.com", password: "another long password", display_name: "Other" } });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "EMAIL_TAKEN");

    const short = await h.call("/v1/account/register", { body: { email: "kamal@example.com", password: "short", display_name: "Kamal" } });
    assert.equal(short.status, 400);
    assert.equal(short.body.success, false);
    assert.deepEqual((short.body.payload as unknown as { issues: Array<{ path: string }> }).issues.map((issue) => issue.path), ["password"]);

    assert.equal((await h.call("/v1/account/register", { method: "POST", headers: { "content-type": "text/plain" }, body: undefined })).status, 400, "an empty body fails validation");
    const anonymous = await h.call("/v1/account/me");
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.body.code, "INVALID_CREDENTIALS");
    assert.equal((await h.call("/v1/account/me", { cookie: "lpl_session=not-a-real-token" })).status, 401);
  } finally {
    h.close();
  }
});

test("secure cookies carry the Secure flag", async () => {
  const h = harness({ secureCookies: true });
  try {
    const registered = await h.register("nimal@example.com");
    assert.match(registered.setCookie!, /; Secure/u);
  } finally {
    h.close();
  }
});

test("login answers alike for an unknown address and a wrong password, and locks after five failures", async () => {
  const h = harness();
  try {
    await h.register("nimal@example.com");
    const login = (email: string, password: string, remember?: boolean) => h.call("/v1/account/login", { body: { email, password, ...(remember === undefined ? {} : { remember }) } });

    const unknown = await login("nobody@example.com", "correct horse battery staple");
    const wrong = await login("nimal@example.com", "not the password");
    assert.equal(unknown.status, 401);
    assert.equal(wrong.status, 401);
    assert.equal(unknown.body.code, "INVALID_CREDENTIALS");
    assert.deepEqual({ ...wrong.body, meta: null }, { ...unknown.body, meta: null }, "nothing in the answer tells the two apart");

    for (let attempt = 2; attempt <= 4; attempt += 1) assert.equal((await login("nimal@example.com", "not the password")).status, 401);
    const locked = await login("nimal@example.com", "not the password");
    assert.equal(locked.status, 423);
    assert.equal(locked.body.code, "ACCOUNT_LOCKED");
    assert.equal((locked.body.payload as unknown as { retry_after_seconds: number }).retry_after_seconds, 900);
    assert.equal(locked.headers.get("retry-after"), "900");
    const stillLocked = await login("nimal@example.com", "correct horse battery staple");
    assert.equal(stillLocked.status, 423, "the right password does not open a locked account");
    assert.ok((stillLocked.body.payload as unknown as { retry_after_seconds: number }).retry_after_seconds <= 900);

    h.database.prepare("UPDATE account SET locked_until = ?").run(new Date(Date.now() - 1_000).toISOString());
    const opened = await login("nimal@example.com", "correct horse battery staple");
    assert.equal(opened.status, 200, "the lock lifts after fifteen minutes");
    assert.match(opened.setCookie!, /Max-Age=2592000/u, "remember defaults to true");
    const day = await login("nimal@example.com", "correct horse battery staple", false);
    assert.match(day.setCookie!, /Max-Age=86400/u, "without remember the session lasts a day");
    assert.equal((h.database.prepare("SELECT failed_login_count FROM account").get() as { failed_login_count: number }).failed_login_count, 0);

    h.database.prepare("UPDATE account SET status = 'disabled'").run();
    const disabled = await login("nimal@example.com", "correct horse battery staple");
    assert.equal(disabled.status, 403);
    assert.equal(disabled.body.code, "ACCOUNT_DISABLED");
    assert.equal((await login("nimal@example.com", "wrong password again")).body.code, "INVALID_CREDENTIALS", "a wrong password does not reveal the disabled state");
    const existing = await h.call("/v1/account/me", { cookie: opened.cookie });
    assert.equal(existing.status, 403, "an existing session of a disabled account stops working");
    assert.equal(existing.body.code, "ACCOUNT_DISABLED");
  } finally {
    h.close();
  }
});

test("the verification link marks the address, signs the browser in, and works once", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const firstToken = h.mail.tokenOf(h.mail.sent[0]!);

    const resent = await h.call("/v1/account/resend-verification", { method: "POST", cookie: registered.cookie });
    assert.equal(resent.status, 200);
    assert.equal(h.mail.sent.length, 2);
    const token = h.mail.tokenOf(h.mail.sent[1]!);
    assert.notEqual(token, firstToken);
    const stale = await h.call("/v1/account/verify-email", { body: { token: firstToken } });
    assert.equal(stale.status, 400, "a newer link voids the older one");
    assert.equal(stale.body.code, "TOKEN_INVALID");

    const verified = await h.call("/v1/account/verify-email", { body: { token } });
    assert.equal(verified.status, 200);
    assert.equal(verified.body.payload.email_verified, true);
    assert.ok(verified.cookie, "a browser without a session is signed in by the link");
    assert.equal((await h.call("/v1/account/me", { cookie: verified.cookie })).body.payload.email_verified, true);
    assert.equal(h.mail.sent[2]?.kind, "welcome");
    assert.equal(h.mail.sent[2]?.link, "https://price.example/");

    const again = await h.call("/v1/account/verify-email", { body: { token } });
    assert.equal(again.status, 400, "a link is single use");
    assert.equal(again.body.code, "TOKEN_INVALID");
    assert.equal((await h.call("/v1/account/resend-verification", { method: "POST", cookie: registered.cookie })).status, 200);
    assert.equal(h.mail.sent.length, 3, "nothing is sent once the address is verified");

    const signedIn = await h.call("/v1/account/verify-email", { body: { token: "x".repeat(43) }, cookie: registered.cookie });
    assert.equal(signedIn.status, 400);
    assert.equal(signedIn.cookie, undefined, "a failed verification sets no cookie");
  } finally {
    h.close();
  }
});

test("forgot and reset: silent for strangers, and a reset signs every session out", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const second = await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" } });
    assert.equal(second.status, 200);

    const stranger = await h.call("/v1/account/forgot-password", { body: { email: "nobody@example.com" } });
    assert.equal(stranger.status, 200);
    assert.equal(stranger.body.success, true);
    assert.equal(h.mail.sent.length, 1, "no mail for an address without an account");

    const forgot = await h.call("/v1/account/forgot-password", { body: { email: "NIMAL@example.com" } });
    assert.equal(forgot.status, 200);
    assert.equal(forgot.body.message, stranger.body.message, "the answer does not say whether the address exists");
    const reset = h.mail.sent[1]!;
    assert.equal(reset.kind, "resetPassword");
    assert.match(reset.link!, /^https:\/\/price\.example\/account\/reset\?token=/u);

    const weak = await h.call("/v1/account/reset-password", { body: { token: h.mail.tokenOf(reset), password: "short" } });
    assert.equal(weak.status, 400);
    const wrongKind = await h.call("/v1/account/verify-email", { body: { token: h.mail.tokenOf(reset) } });
    assert.equal(wrongKind.body.code, "TOKEN_INVALID", "a reset token does not verify an address");

    const done = await h.call("/v1/account/reset-password", { body: { token: h.mail.tokenOf(reset), password: "a brand new passphrase" } });
    assert.equal(done.status, 200, done.body.message);
    assert.ok(done.cookie, "the browser that reset the password is signed in");
    assert.equal(done.body.payload.email_verified, true, "following the reset link proves the address");
    assert.equal((await h.call("/v1/account/me", { cookie: registered.cookie })).status, 401, "the earlier sessions are gone");
    assert.equal((await h.call("/v1/account/me", { cookie: second.cookie })).status, 401);
    assert.equal((await h.call("/v1/account/me", { cookie: done.cookie })).status, 200);
    assert.equal(h.mail.sent[2]?.kind, "passwordChanged");
    assert.equal(h.mail.sent[2]?.to, "nimal@example.com");

    assert.equal((await h.call("/v1/account/reset-password", { body: { token: h.mail.tokenOf(reset), password: "a brand new passphrase" } })).status, 400, "the reset link works once");
    assert.equal((await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" } })).status, 401);
    assert.equal((await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "a brand new passphrase" } })).status, 200);

    h.database.prepare("UPDATE account SET status = 'disabled'").run();
    await h.call("/v1/account/forgot-password", { body: { email: "nimal@example.com" } });
    assert.equal(h.mail.sent.length, 3, "a disabled account gets no reset mail");
  } finally {
    h.close();
  }
});

test("changing the password keeps this session and signs the others out", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const other = await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" } });
    const wrong = await h.call("/v1/account/change-password", { body: { current_password: "not it", new_password: "a brand new passphrase" }, cookie: registered.cookie });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, "PASSWORD_WRONG");
    assert.equal((await h.call("/v1/account/change-password", { body: { current_password: "correct horse battery staple", new_password: "a brand new passphrase" } })).status, 401, "needs a session");

    const changed = await h.call("/v1/account/change-password", { body: { current_password: "correct horse battery staple", new_password: "a brand new passphrase" }, cookie: registered.cookie });
    assert.equal(changed.status, 200);
    assert.equal((await h.call("/v1/account/me", { cookie: registered.cookie })).status, 200, "the session that changed the password stays");
    assert.equal((await h.call("/v1/account/me", { cookie: other.cookie })).status, 401, "the other session is signed out");
    assert.equal(h.mail.sent.at(-1)?.kind, "passwordChanged");
    assert.equal((await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "a brand new passphrase" } })).status, 200);
  } finally {
    h.close();
  }
});

test("changing the address confirms through the new one and tells the old one", async () => {
  const h = harness();
  try {
    await h.register("taken@example.com");
    const registered = await h.register("nimal@example.com");
    const change = (body: unknown) => h.call("/v1/account/change-email", { body, cookie: registered.cookie });
    assert.equal((await change({ new_email: "new@example.com", password: "wrong" })).body.code, "PASSWORD_WRONG");
    assert.equal((await change({ new_email: "Taken@example.com", password: "correct horse battery staple" })).body.code, "EMAIL_TAKEN");
    assert.equal((await change({ new_email: "nimal@example.com", password: "correct horse battery staple" })).body.code, "EMAIL_TAKEN", "the current address counts as taken");
    assert.equal((await change({ new_email: "not an address", password: "correct horse battery staple" })).status, 400);

    const started = await change({ new_email: "New@Example.com", password: "correct horse battery staple" });
    assert.equal(started.status, 200);
    const mail = h.mail.sent.at(-1)!;
    assert.equal(mail.kind, "changeEmail");
    assert.equal(mail.to, "new@example.com", "the confirmation goes to the new address");
    assert.equal(mail.newEmail, "new@example.com");
    assert.match(mail.link!, /^https:\/\/price\.example\/account\/confirm-email\?token=/u);
    assert.equal((await h.call("/v1/account/me", { cookie: registered.cookie })).body.payload.email, "nimal@example.com", "nothing changes until the link is followed");

    const confirmed = await h.call("/v1/account/confirm-email", { body: { token: h.mail.tokenOf(mail) } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.payload.email, "new@example.com");
    assert.equal(confirmed.body.payload.email_verified, true);
    const notice = h.mail.sent.at(-1)!;
    assert.equal(notice.kind, "emailChanged");
    assert.equal(notice.to, "nimal@example.com", "the old address hears about it");
    assert.equal(notice.newEmail, "new@example.com");
    assert.equal((await h.call("/v1/account/confirm-email", { body: { token: h.mail.tokenOf(mail) } })).body.code, "TOKEN_INVALID");
    assert.equal((await h.call("/v1/account/login", { body: { email: "new@example.com", password: "correct horse battery staple" } })).status, 200);
    assert.equal((await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" } })).status, 401);

    // The new address was free when the link was made but taken by the time it is followed.
    await change({ new_email: "later@example.com", password: "correct horse battery staple" });
    const pending = h.mail.sent.at(-1)!;
    await h.register("later@example.com");
    assert.equal((await h.call("/v1/account/confirm-email", { body: { token: h.mail.tokenOf(pending) } })).body.code, "EMAIL_TAKEN");
  } finally {
    h.close();
  }
});

test("deleting the account needs the password and takes everything with it", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const remove = (body: unknown) => h.call("/v1/account/me", { method: "DELETE", body, cookie: registered.cookie });
    assert.equal((await remove({ confirm: "delete" })).status, 400, "the confirmation word is exact");
    const missing = await remove({ confirm: "DELETE" });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.code, "PASSWORD_REQUIRED");
    const wrong = await remove({ confirm: "DELETE", password: "not it" });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.code, "PASSWORD_WRONG");

    const deleted = await remove({ confirm: "DELETE", password: "correct horse battery staple" });
    assert.equal(deleted.status, 200);
    assert.match(deleted.setCookie!, /lpl_session=;/u, "the cookie is cleared");
    assert.equal((await h.call("/v1/account/me", { cookie: registered.cookie })).status, 401);
    assert.equal(h.store.countAccounts(), 0);
    assert.equal((h.database.prepare("SELECT COUNT(*) AS count FROM account_session").get() as { count: number }).count, 0, "sessions go with the account");
    assert.equal((h.database.prepare("SELECT COUNT(*) AS count FROM account_token").get() as { count: number }).count, 0, "tokens too");
    assert.equal(h.mail.sent.at(-1)?.kind, "accountDeleted");

    // An account without a password (Google only) deletes on the confirmation word alone.
    const google = h.store.createAccount({ email: "g@example.com", passwordHash: null, displayName: "G", emailVerified: true }, new Date());
    const token = h.store.createSession(google.id, { userAgent: null, address: null }, 3600, new Date());
    assert.equal((await h.call("/v1/account/me", { method: "DELETE", body: { confirm: "DELETE" }, cookie: `lpl_session=${token}` })).status, 200);
    assert.equal(h.store.countAccounts(), 0);
  } finally {
    h.close();
  }
});

test("requireVerified refuses an unverified address with a code; readAccount never refuses", async () => {
  const h = harness();
  try {
    assert.equal((await h.call("/v1/test/verified-only")).status, 401);
    assert.deepEqual(JSON.parse(JSON.stringify((await h.call("/v1/test/optional")).body)), { email: null });
    const registered = await h.register("nimal@example.com");
    const unverified = await h.call("/v1/test/verified-only", { cookie: registered.cookie });
    assert.equal(unverified.status, 403);
    assert.equal(unverified.body.code, "EMAIL_NOT_VERIFIED");
    assert.deepEqual(JSON.parse(JSON.stringify((await h.call("/v1/test/optional", { cookie: registered.cookie })).body)), { email: "nimal@example.com" });
    await h.call("/v1/account/verify-email", { body: { token: h.mail.tokenOf(h.mail.sent[0]!) } });
    const verified = await h.call("/v1/test/verified-only", { cookie: registered.cookie });
    assert.equal(verified.status, 200);
    assert.deepEqual(JSON.parse(JSON.stringify(verified.body)), { email: "nimal@example.com" });
  } finally {
    h.close();
  }
});

test("the routes anyone can call keep a budget per address", async () => {
  const h = harness({ rateLimits: { forgot: new RateLimiter(5, 15 * 60_000), login: new RateLimiter(5, 15 * 60_000) } });
  try {
    for (let attempt = 1; attempt <= 5; attempt += 1) assert.equal((await h.call("/v1/account/forgot-password", { body: { email: `n${attempt}@example.com` } })).status, 200);
    const limited = await h.call("/v1/account/forgot-password", { body: { email: "n6@example.com" } });
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "RATE_LIMITED");
    assert.equal((await h.call("/v1/account/forgot-password", { body: { email: "n6@example.com" }, headers: { "x-forwarded-for": "198.51.100.9" } })).status, 200, "another address has its own budget");
    assert.equal((await h.call("/v1/account/forgot-password", { body: { email: "not an address" } })).status, 400, "a request that fails validation is refused before the budget");
    for (let attempt = 1; attempt <= 5; attempt += 1) assert.equal((await h.call("/v1/account/login", { body: { email: "n@example.com", password: "whatever it is" } })).status, 401);
    assert.equal((await h.call("/v1/account/login", { body: { email: "n@example.com", password: "whatever it is" } })).status, 429);
  } finally {
    h.close();
  }
});

test("state-changing routes refuse another origin", async () => {
  const h = harness();
  try {
    await h.register("nimal@example.com");
    const foreign = await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" }, headers: { origin: "https://evil.example" } });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.body.success, false);
    const own = await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" }, headers: { origin: "http://localhost" } });
    assert.equal(own.status, 200);
    assert.equal((await h.call("/v1/account/me", { cookie: own.cookie, headers: { origin: "https://evil.example" } })).status, 200, "reads are not affected");
    assert.equal((await h.call("/v1/account/logout", { method: "POST", cookie: own.cookie, headers: { origin: "https://evil.example" } })).status, 403);
    assert.equal((await h.call("/v1/account/me", { method: "PATCH", body: { display_name: "X" }, cookie: own.cookie, headers: { origin: "https://evil.example" } })).status, 403);
    const proxied = await h.call("/v1/account/logout", { method: "POST", cookie: own.cookie, headers: { origin: "https://price.example", "x-forwarded-host": "price.example", "x-forwarded-proto": "https" } });
    assert.equal(proxied.status, 200, "behind the proxy the forwarded host is the site");
    assert.match(proxied.setCookie!, /lpl_session=;/u);
    assert.equal((await h.call("/v1/account/me", { cookie: own.cookie })).status, 401, "logout revokes the session");
  } finally {
    h.close();
  }
});

test("remember-me sessions slide once half the window has passed; short sessions do not", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const now = Date.now();
    const day = 24 * 3600 * 1_000;
    const row = () => h.database.prepare("SELECT expires_at FROM account_session ORDER BY created_at DESC LIMIT 1").get() as { expires_at: string };

    h.database.prepare("UPDATE account_session SET created_at = ?, expires_at = ?").run(new Date(now - 10 * day).toISOString(), new Date(now + 20 * day).toISOString());
    const early = await h.call("/v1/account/me", { cookie: registered.cookie });
    assert.equal(early.status, 200);
    assert.equal(early.setCookie, null, "less than half the window has passed: nothing changes");
    assert.equal(row().expires_at, new Date(now + 20 * day).toISOString());

    h.database.prepare("UPDATE account_session SET created_at = ?, expires_at = ?").run(new Date(now - 20 * day).toISOString(), new Date(now + 10 * day).toISOString());
    const late = await h.call("/v1/account/me", { cookie: registered.cookie });
    assert.equal(late.status, 200);
    assert.match(late.setCookie!, /Max-Age=2592000/u, "the cookie is re-issued for another thirty days");
    assert.equal(late.cookie, registered.cookie, "with the same token");
    const extended = new Date(row().expires_at).getTime();
    assert.ok(extended > now + 29 * day && extended <= Date.now() + 30 * day, "the stored expiry moved out to thirty days from now");

    const short = await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple", remember: false } });
    h.database.prepare("UPDATE account_session SET created_at = ?, expires_at = ? WHERE expires_at = (SELECT MIN(expires_at) FROM account_session)").run(new Date(now - 20 * 3600 * 1_000).toISOString(), new Date(now + 4 * 3600 * 1_000).toISOString());
    const dayLater = await h.call("/v1/account/me", { cookie: short.cookie });
    assert.equal(dayLater.status, 200);
    assert.equal(dayLater.setCookie, null, "a one-day session is not renewed");
    assert.equal((h.database.prepare("SELECT MIN(expires_at) AS expires_at FROM account_session").get() as { expires_at: string }).expires_at, new Date(now + 4 * 3600 * 1_000).toISOString());

    h.database.prepare("UPDATE account_session SET expires_at = ?").run(new Date(now - 1_000).toISOString());
    assert.equal((await h.call("/v1/account/me", { cookie: registered.cookie })).status, 401, "an expired session is not renewed");
  } finally {
    h.close();
  }
});

test("the profile page lists live sessions and signs the others out", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const phone = await h.call("/v1/account/login", { body: { email: "nimal@example.com", password: "correct horse battery staple" }, headers: { "user-agent": "Phone/2.0", "x-forwarded-for": "198.51.100.9" } });
    const list = await h.call("/v1/account/sessions", { cookie: registered.cookie });
    assert.equal(list.status, 200);
    const sessions = list.body.payload as unknown as Array<{ id: string; user_agent: string; address: string; current: boolean }>;
    assert.equal(sessions.length, 2);
    assert.deepEqual(sessions.map((session) => [session.user_agent, session.address, session.current]), [["Phone/2.0", "198.51.100.9", false], ["TestBrowser/1.0", "203.0.113.7", true]]);
    assert.ok(sessions.every((session) => /^[a-f0-9]{16}$/u.test(session.id)));
    assert.equal(JSON.stringify(list.body).includes(registered.cookie!.slice("lpl_session=".length)), false, "the token never appears");

    const revoked = await h.call("/v1/account/sessions/revoke-others", { method: "POST", cookie: registered.cookie });
    assert.equal(revoked.status, 200);
    assert.deepEqual(revoked.body.payload, { revoked: 1 });
    assert.equal((await h.call("/v1/account/me", { cookie: phone.cookie })).status, 401);
    assert.equal((await h.call("/v1/account/me", { cookie: registered.cookie })).status, 200);
    assert.equal(((await h.call("/v1/account/sessions", { cookie: registered.cookie })).body.payload as unknown as unknown[]).length, 1);
  } finally {
    h.close();
  }
});

test("the profile patch changes the name, the language, and single preferences", async () => {
  const h = harness();
  try {
    const registered = await h.register("nimal@example.com");
    const patch = (body: unknown) => h.call("/v1/account/me", { method: "PATCH", body, cookie: registered.cookie });
    const named = await patch({ display_name: "  Nimal Perera ", locale: "si" });
    assert.equal(named.status, 200);
    assert.equal(named.body.payload.display_name, "Nimal Perera");
    assert.equal(named.body.payload.locale, "si");
    const prefs = await patch({ preferences: { notify_digest: true } });
    assert.deepEqual(prefs.body.payload.preferences, { notify_email: true, notify_digest: true, notify_alerts: false }, "the other preferences keep their values");
    assert.equal((await patch({ locale: "fr" })).status, 400);
    assert.equal((await patch({ display_name: "" })).status, 400);
    const unchanged = await h.call("/v1/account/me", { cookie: registered.cookie });
    assert.equal(unchanged.body.payload.locale, "si");
    assert.equal((await patch({})).status, 200, "an empty patch is fine");
  } finally {
    h.close();
  }
});

test("a mail failure is logged and never fails the request", async () => {
  const h = harness();
  try {
    h.mail.state.fail = true;
    const registered = await h.register("nimal@example.com");
    assert.equal(registered.status, 201);
    assert.equal(h.logs.length, 1);
    assert.deepEqual(h.logs[0], { level: "error", message: "Account mail failed", kind: "verify_email", to: "n***@example.com", detail: "SendGrid said no" });
    h.mail.mailer.resetPassword = async () => {
      throw new Error("network down");
    };
    assert.equal((await h.call("/v1/account/forgot-password", { body: { email: "nimal@example.com" } })).status, 200);
    assert.equal(h.logs[1]?.detail, "network down");
  } finally {
    h.close();
  }
});
