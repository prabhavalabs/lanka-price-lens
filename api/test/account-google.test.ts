import assert from "node:assert/strict";
import { preferencesSchema } from "@lanka-pricelens/shared";
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import test from "node:test";

import { buildAuthorizationUrl, googleKeySource, googleRoutes, parseReturnTo, readState, resolveAccount, signState, verifyIdToken, verifyWithGoogleKeys, type GoogleJwk } from "../src/account/google.ts";
import { defaultAccountConfig, type Account, type AccountConfig, type AccountIdentity, type AccountStore } from "../src/account/types.ts";

/** A signing key that stands in for Google's, published the way Google publishes its own. */
function testKey(kid: string): { privateKey: KeyObject; jwk: GoogleJwk } {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const exported = publicKey.export({ format: "jwk" }) as { kty: string; n: string; e: string };
  return { privateKey, jwk: { kid, kty: exported.kty, n: exported.n, e: exported.e, alg: "RS256", use: "sig" } };
}

const google = testKey("key-2026-09");
const stranger = testKey("key-2026-09");
const clientId = "1234.apps.googleusercontent.com";
const now = new Date("2026-09-13T08:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function idToken(claims: Record<string, unknown>, options: { privateKey?: KeyObject; kid?: string; alg?: string } = {}): string {
  const header = encode({ alg: options.alg ?? "RS256", kid: options.kid ?? google.jwk.kid, typ: "JWT" });
  const payload = encode({ iss: "https://accounts.google.com", aud: clientId, sub: "10769150350006150715113082367", email: "Amal.Perera@gmail.com", email_verified: true, name: "Amal Perera", picture: "https://lh3.googleusercontent.com/a/photo", locale: "si-LK", iat: nowSeconds - 10, exp: nowSeconds + 3600, ...claims });
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), options.privateKey ?? google.privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

function failsWith(token: string, code: string, keys: GoogleJwk[] = [google.jwk]): void {
  assert.throws(() => verifyIdToken(token, { clientId, keys, now }), (error: unknown) => error instanceof Error && "code" in error && error.code === code, code);
}

test("a well-formed ID token signed by a published key yields the profile", () => {
  const profile = verifyIdToken(idToken({}), { clientId, keys: [stranger.jwk, google.jwk].map((jwk, index) => ({ ...jwk, kid: index === 0 ? "older" : jwk.kid })), now });
  assert.deepEqual(profile, { subject: "10769150350006150715113082367", email: "amal.perera@gmail.com", email_verified: true, name: "Amal Perera", picture: "https://lh3.googleusercontent.com/a/photo", locale: "si-LK" });
  const bare = verifyIdToken(idToken({ iss: "accounts.google.com", name: undefined, picture: undefined, locale: undefined, aud: [clientId, "other"] }), { clientId, keys: [google.jwk], now });
  assert.deepEqual(bare, { subject: "10769150350006150715113082367", email: "amal.perera@gmail.com", email_verified: true, name: null, picture: null, locale: null });
});

test("an ID token is refused when the signature, issuer, audience, expiry, or email do not hold", () => {
  failsWith(idToken({}, { privateKey: stranger.privateKey }), "ID_TOKEN_SIGNATURE");
  failsWith(idToken({}, { kid: "unknown" }), "ID_TOKEN_KEY_UNKNOWN");
  failsWith(idToken({}, { alg: "HS256" }), "ID_TOKEN_ALGORITHM");
  failsWith(idToken({}, { alg: "none" }), "ID_TOKEN_ALGORITHM");
  failsWith(idToken({ iss: "https://evil.example" }), "ID_TOKEN_ISSUER");
  failsWith(idToken({ aud: "someone-else" }), "ID_TOKEN_AUDIENCE");
  failsWith(idToken({ exp: nowSeconds - 120 }), "ID_TOKEN_EXPIRED");
  failsWith(idToken({ exp: "soon" }), "ID_TOKEN_EXPIRED");
  failsWith(idToken({ email_verified: false }), "ID_TOKEN_EMAIL_UNVERIFIED");
  failsWith(idToken({ email: "" }), "ID_TOKEN_EMAIL");
  failsWith(idToken({ sub: "" }), "ID_TOKEN_SUBJECT");
  failsWith("not.a-token", "ID_TOKEN_MALFORMED");
  failsWith("a.b.c", "ID_TOKEN_MALFORMED");
  // A token whose payload was altered after signing no longer verifies.
  const [header, , signature] = idToken({}).split(".") as [string, string, string];
  failsWith(`${header}.${encode({ iss: "https://accounts.google.com", aud: clientId, sub: "1", email: "x@example.com", email_verified: true, exp: nowSeconds + 60 })}.${signature}`, "ID_TOKEN_SIGNATURE");
  // A token from the near past is fine within the leeway.
  assert.ok(verifyIdToken(idToken({ exp: nowSeconds - 10 }), { clientId, keys: [google.jwk], now }));
});

test("keys are fetched once per max-age, refreshed for an unknown key id, and not more than once a minute", async () => {
  let served: GoogleJwk[] = [google.jwk];
  let fetches = 0;
  let clock = now.getTime();
  const request = (async () => {
    fetches += 1;
    return new Response(JSON.stringify({ keys: served }), { headers: { "cache-control": "public, max-age=3600, must-revalidate", "content-type": "application/json" } });
  }) as typeof fetch;
  const keys = googleKeySource(request, { clock: () => clock });
  await verifyWithGoogleKeys(idToken({}), clientId, keys, now);
  await verifyWithGoogleKeys(idToken({}), clientId, keys, now);
  assert.equal(fetches, 1, "the second check reuses the cached keys");

  // Google rotates its keys: a token signed with a key we have not seen triggers one refresh, but not within a minute of the last fetch.
  const rotated = testKey("key-2026-10");
  const fresh = idToken({}, { kid: "key-2026-10", privateKey: rotated.privateKey });
  served = [rotated.jwk, google.jwk];
  await assert.rejects(verifyWithGoogleKeys(fresh, clientId, keys, now), /ID_TOKEN_KEY_UNKNOWN/u);
  assert.equal(fetches, 1, "a refresh right after a fetch is not repeated");
  clock += 61_000;
  assert.equal((await verifyWithGoogleKeys(fresh, clientId, keys, now)).subject, "10769150350006150715113082367");
  assert.equal(fetches, 2, "the refresh happened once the minute passed");
  await verifyWithGoogleKeys(idToken({}), clientId, keys, now);
  assert.equal(fetches, 2, "the old key is still served from the same set");

  // Past the max-age the set is fetched again on the next check; an unknown key that is not published stays unknown.
  clock += 3600_000;
  await verifyWithGoogleKeys(fresh, clientId, keys, now);
  assert.equal(fetches, 3);
  clock += 61_000;
  await assert.rejects(verifyWithGoogleKeys(idToken({}, { kid: "never-published" }), clientId, keys, now), /ID_TOKEN_KEY_UNKNOWN/u);
  assert.equal(fetches, 4, "one refresh, then the failure stands");

  const down = googleKeySource((async () => new Response("nope", { status: 503 })) as typeof fetch);
  await assert.rejects(verifyWithGoogleKeys(idToken({}), clientId, down, now), /CERTS_UNAVAILABLE: HTTP 503/u);
});

test("the authorization url carries PKCE, the scopes, and the account chooser", () => {
  const url = new URL(buildAuthorizationUrl({ clientId, redirectUri: "http://localhost:3000/v1/auth/google/callback", state: "st", codeChallenge: "ch" }));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), clientId);
  assert.equal(url.searchParams.get("redirect_uri"), "http://localhost:3000/v1/auth/google/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "st");
  assert.equal(url.searchParams.get("code_challenge"), "ch");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("access_type"), "online");
  assert.equal(url.searchParams.get("prompt"), "select_account");
  assert.equal(url.searchParams.get("login_hint"), null);
});

test("return_to accepts only a path on this site", () => {
  assert.equal(parseReturnTo("/menus"), "/menus");
  assert.equal(parseReturnTo("/recipes/r_1?servings=4#cost"), "/recipes/r_1?servings=4#cost");
  assert.equal(parseReturnTo(" /account "), "/account");
  assert.equal(parseReturnTo(undefined), "/");
  assert.equal(parseReturnTo(""), "/");
  assert.equal(parseReturnTo("menus"), "/");
  assert.equal(parseReturnTo("https://evil.example/"), "/");
  assert.equal(parseReturnTo("//evil.example/"), "/");
  assert.equal(parseReturnTo("/\\evil.example"), "/");
  assert.equal(parseReturnTo("/menus\nSet-Cookie: x=1"), "/");
  assert.equal(parseReturnTo("/v1/account/me"), "/");
  assert.equal(parseReturnTo(`/${"a".repeat(2001)}`), "/");
  assert.equal(parseReturnTo(null, "/account"), "/account");
});

test("the state cookie survives a round trip, and is refused when altered, signed with another secret, or expired", () => {
  const payload = { state: "abc", verifier: "ver", return_to: "/menus", exp: nowSeconds + 600 };
  const cookie = signState(payload, "secret");
  assert.deepEqual(readState(cookie, "secret", now), payload);
  assert.equal(readState(cookie, "another", now), null);
  assert.equal(readState(`${cookie}x`, "secret", now), null);
  const [body, signature] = cookie.split(".") as [string, string];
  assert.equal(readState(`${body.slice(0, -2)}${signature}`, "secret", now), null);
  assert.equal(readState(`${encode({ ...payload, return_to: "//evil" })}.${signature}`, "secret", now), null);
  assert.equal(readState(cookie, "secret", new Date((payload.exp + 1) * 1000)), null);
  assert.equal(readState(undefined, "secret", now), null);
  assert.equal(readState("nodot", "secret", now), null);
});

/** Just enough of the store for sign-in: accounts by id and address, identities, verification. */
function memoryStore() {
  const accounts = new Map<string, Account>();
  const identities: AccountIdentity[] = [];
  let sequence = 0;
  const unused = (): never => {
    throw new Error("not used by google sign-in");
  };
  const store: AccountStore = {
    createAccount: (input, at) => {
      sequence += 1;
      const account: Account = { id: `account_${sequence}`, email: input.email, email_verified_at: input.emailVerified ? at.toISOString() : null, password_hash: input.passwordHash, display_name: input.displayName, avatar_url: input.avatarUrl ?? null, locale: input.locale ?? "en", status: "active", failed_login_count: 0, locked_until: null, preferences: preferencesSchema.parse({}), created_at: at.toISOString(), updated_at: at.toISOString() };
      accounts.set(account.id, account);
      return account;
    },
    findAccountById: (id) => accounts.get(id),
    findAccountByEmail: (email) => [...accounts.values()].find((account) => account.email.toLowerCase() === email.toLowerCase()),
    updateAccount: (id, patch, at) => {
      const current = accounts.get(id);
      if (!current) throw new Error("no such account");
      const next = { ...current, ...patch, updated_at: at.toISOString() };
      accounts.set(id, next);
      return next;
    },
    recordLoginFailure: unused,
    recordLoginSuccess: unused,
    deleteAccount: unused,
    countAccounts: () => accounts.size,
    listAccounts: unused,
    createSession: unused,
    findSession: unused,
    extendSession: unused,
    revokeSession: unused,
    revokeSessions: unused,
    listSessions: unused,
    createToken: unused,
    consumeToken: unused,
    linkIdentity: (identity, at) => {
      const linked = { ...identity, created_at: at.toISOString() };
      identities.push(linked);
      return linked;
    },
    findIdentity: (provider, subject) => identities.find((identity) => identity.provider === provider && identity.subject === subject),
    listIdentities: (accountId) => identities.filter((identity) => identity.account_id === accountId),
    unlinkIdentity: unused,
  };
  return { store, accounts, identities };
}

const config: AccountConfig = { ...defaultAccountConfig, siteOrigin: null, google: { clientId, clientSecret: "shh" }, stateSecret: "state-secret", secureCookies: false };

/** Google's two endpoints, answered locally: the token exchange (recorded) and the published keys. */
function fakeGoogle(options: { token?: (form: URLSearchParams) => Response } = {}) {
  const exchanges: URLSearchParams[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address === "https://www.googleapis.com/oauth2/v3/certs") return new Response(JSON.stringify({ keys: [google.jwk] }), { headers: { "cache-control": "max-age=3600" } });
    if (address === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(String(init?.body));
      exchanges.push(form);
      return options.token ? options.token(form) : new Response(JSON.stringify({ access_token: "at", id_token: idToken({}), token_type: "Bearer" }));
    }
    throw new Error(`unexpected request to ${address}`);
  }) as typeof fetch;
  return { request, exchanges };
}

function cookieValue(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const match = new RegExp(`^${name}=([^;]*)`, "u").exec(header);
    if (match) return match[1] ?? null;
  }
  return null;
}

async function start(app: ReturnType<typeof googleRoutes>, returnTo = "/menus") {
  const response = await app.request(`/start?return_to=${encodeURIComponent(returnTo)}`, { headers: { host: "localhost:3000" } });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  const stateCookie = cookieValue(response, "lpl_google_state");
  assert.ok(stateCookie);
  return { location, stateCookie, state: location.searchParams.get("state")!, challenge: location.searchParams.get("code_challenge")! };
}

test("start redirects to Google with PKCE and keeps the state in a signed HttpOnly cookie", async () => {
  const lines: string[] = [];
  const app = googleRoutes({ store: memoryStore().store, config, createSession: () => "tok", fetch: fakeGoogle().request, now: () => now, log: (line) => lines.push(line) });
  const response = await app.request("/start?return_to=%2Fmenus", { headers: { host: "localhost:3000", "x-forwarded-proto": "http" } });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assert.equal(location.origin, "https://accounts.google.com");
  assert.equal(location.searchParams.get("redirect_uri"), "http://localhost:3000/v1/auth/google/callback");
  assert.equal(location.searchParams.get("client_id"), clientId);
  assert.equal(location.searchParams.get("code_challenge_method"), "S256");
  const setCookie = response.headers.getSetCookie().find((header) => header.startsWith("lpl_google_state="))!;
  assert.match(setCookie, /HttpOnly/u);
  assert.match(setCookie, /SameSite=Lax/u);
  assert.match(setCookie, /Max-Age=600/u);
  const saved = readState(cookieValue(response, "lpl_google_state")!, config.stateSecret, now)!;
  assert.equal(saved.state, location.searchParams.get("state"));
  assert.equal(saved.return_to, "/menus");
  assert.equal(createHash("sha256").update(saved.verifier).digest("base64url"), location.searchParams.get("code_challenge"));

  // The configured origin wins over the request's.
  const fixed = googleRoutes({ store: memoryStore().store, config: { ...config, siteOrigin: "https://badumila.com/" }, createSession: () => "tok", fetch: fakeGoogle().request });
  const production = await fixed.request("/start", { headers: { host: "localhost:3000" } });
  assert.equal(new URL(production.headers.get("location")!).searchParams.get("redirect_uri"), "https://badumila.com/v1/auth/google/callback");

  // Without a client there is nothing to start.
  const unconfigured = googleRoutes({ store: memoryStore().store, config: { ...config, google: null }, createSession: () => "tok", log: (line) => lines.push(line) });
  const refused = await unconfigured.request("/start");
  assert.equal(refused.status, 302);
  assert.equal(refused.headers.get("location"), "/account/login?error=google");
  assert.match(lines.at(-1)!, /LPL_GOOGLE_CLIENT_ID/u);
});

test("callback trades the code with the verifier, verifies the token, creates a verified account, and signs the browser in", async () => {
  const { store, accounts, identities } = memoryStore();
  const sessions: Array<{ accountId: string; meta: { userAgent: string | null; address: string | null } }> = [];
  const upstream = fakeGoogle();
  const app = googleRoutes({ store, config, createSession: (accountId, meta) => { sessions.push({ accountId, meta }); return "session-token"; }, fetch: upstream.request, now: () => now });
  const started = await start(app, "/menus");
  const response = await app.request(`/callback?code=4%2F0AbCd&state=${encodeURIComponent(started.state)}`, { headers: { host: "localhost:3000", cookie: `lpl_google_state=${started.stateCookie}`, "user-agent": "test-browser", "x-forwarded-for": "203.0.113.9" } });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/menus");

  const exchange = upstream.exchanges[0]!;
  assert.equal(exchange.get("code"), "4/0AbCd");
  assert.equal(exchange.get("grant_type"), "authorization_code");
  assert.equal(exchange.get("client_id"), clientId);
  assert.equal(exchange.get("client_secret"), "shh");
  assert.equal(exchange.get("redirect_uri"), "http://localhost:3000/v1/auth/google/callback");
  assert.equal(createHash("sha256").update(exchange.get("code_verifier")!).digest("base64url"), started.challenge, "the verifier matches the challenge sent to Google");

  assert.equal(accounts.size, 1);
  const account = [...accounts.values()][0]!;
  assert.equal(account.email, "amal.perera@gmail.com");
  assert.equal(account.email_verified_at, now.toISOString());
  assert.equal(account.password_hash, null);
  assert.equal(account.display_name, "Amal Perera");
  assert.equal(account.avatar_url, "https://lh3.googleusercontent.com/a/photo");
  assert.equal(account.locale, "si");
  assert.deepEqual(identities.map((identity) => [identity.provider, identity.subject, identity.account_id, identity.email]), [["google", "10769150350006150715113082367", account.id, "amal.perera@gmail.com"]]);
  assert.deepEqual(sessions, [{ accountId: account.id, meta: { userAgent: "test-browser", address: "203.0.113.9" } }]);

  const cookies = response.headers.getSetCookie();
  const session = cookies.find((header) => header.startsWith("lpl_session="))!;
  assert.match(session, /^lpl_session=session-token;/u);
  assert.match(session, /HttpOnly/u);
  assert.match(session, /SameSite=Lax/u);
  assert.match(session, /Path=\//u);
  assert.match(session, new RegExp(`Max-Age=${config.sessionSeconds}`, "u"));
  assert.ok(!/Secure/u.test(session), "not secure on plain http, per config");
  assert.ok(cookies.some((header) => header.startsWith("lpl_google_state=") && /Max-Age=0/u.test(header)), "the state cookie is cleared");

  // Signing in again with the same Google account finds the same account and opens a new session.
  const again = await start(app, "/");
  const second = await app.request(`/callback?code=next&state=${encodeURIComponent(again.state)}`, { headers: { host: "localhost:3000", cookie: `lpl_google_state=${again.stateCookie}` } });
  assert.equal(second.headers.get("location"), "/");
  assert.equal(accounts.size, 1);
  assert.equal(identities.length, 1);
  assert.equal(sessions.length, 2);
});

test("an existing account with the same address is linked and becomes verified; a disabled one is refused", async () => {
  const { store, accounts, identities } = memoryStore();
  const existing = store.createAccount({ email: "amal.perera@gmail.com", passwordHash: "scrypt$salt$hash", displayName: "Amal", emailVerified: false }, new Date("2026-08-01T00:00:00.000Z"));
  const app = googleRoutes({ store, config, createSession: () => "tok", fetch: fakeGoogle().request, now: () => now });
  const started = await start(app);
  const response = await app.request(`/callback?code=c&state=${encodeURIComponent(started.state)}`, { headers: { host: "localhost:3000", cookie: `lpl_google_state=${started.stateCookie}` } });
  assert.equal(response.headers.get("location"), "/menus");
  assert.equal(accounts.size, 1);
  const linked = accounts.get(existing.id)!;
  assert.equal(linked.email_verified_at, now.toISOString());
  assert.equal(linked.password_hash, "scrypt$salt$hash", "the password stays");
  assert.equal(linked.display_name, "Amal", "the name the person chose stays");
  assert.equal(identities[0]?.account_id, existing.id);

  store.updateAccount(existing.id, { status: "disabled" }, now);
  const lines: string[] = [];
  const guarded = googleRoutes({ store, config, createSession: () => { throw new Error("must not open a session"); }, fetch: fakeGoogle().request, now: () => now, log: (line) => lines.push(line) });
  const blocked = await start(guarded);
  const refused = await guarded.request(`/callback?code=c&state=${encodeURIComponent(blocked.state)}`, { headers: { host: "localhost:3000", cookie: `lpl_google_state=${blocked.stateCookie}` } });
  assert.equal(refused.headers.get("location"), "/account/login?error=google");
  assert.match(lines.at(-1)!, /disabled/u);
  assert.ok(!refused.headers.getSetCookie().some((header) => header.startsWith("lpl_session=")));
});

test("resolveAccount falls back to the address's local part for a name and to the default locale", () => {
  const { store } = memoryStore();
  const account = resolveAccount(store, { subject: "s1", email: "nimal.silva@example.com", email_verified: true, name: null, picture: null, locale: "de" }, now);
  assert.equal(account.display_name, "nimal.silva");
  assert.equal(account.locale, "en");
  assert.equal(account.avatar_url, null);
  const tamil = resolveAccount(store, { subject: "s2", email: "k@example.com", email_verified: true, name: "  Kavitha  ", picture: null, locale: "ta" }, now);
  assert.equal(tamil.display_name, "Kavitha");
  assert.equal(tamil.locale, "ta");
});

test("callback fails closed: bad or missing state, Google's own error, a failed exchange, an unverified address", async () => {
  const lines: string[] = [];
  const { store, accounts } = memoryStore();
  const upstream = fakeGoogle();
  const app = googleRoutes({ store, config, createSession: () => "tok", fetch: upstream.request, now: () => now, log: (line) => lines.push(line) });
  const expectFailure = async (path: string, headers: Record<string, string>, reason: RegExp) => {
    const response = await app.request(path, { headers: { host: "localhost:3000", ...headers } });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/account/login?error=google");
    assert.match(lines.at(-1)!, reason);
    assert.ok(!response.headers.getSetCookie().some((header) => header.startsWith("lpl_session=")), "no session cookie");
  };
  await expectFailure("/callback?code=c&state=x", {}, /state cookie missing/u);
  const started = await start(app);
  await expectFailure("/callback?code=c&state=other", { cookie: `lpl_google_state=${started.stateCookie}` }, /state mismatch/u);
  await expectFailure(`/callback?code=c&state=${encodeURIComponent(started.state)}`, { cookie: `lpl_google_state=${started.stateCookie}x` }, /altered/u);
  await expectFailure(`/callback?error=access_denied&state=${encodeURIComponent(started.state)}`, { cookie: `lpl_google_state=${started.stateCookie}` }, /access_denied/u);
  await expectFailure(`/callback?state=${encodeURIComponent(started.state)}`, { cookie: `lpl_google_state=${started.stateCookie}` }, /no code/u);
  assert.equal(upstream.exchanges.length, 0, "nothing reached Google's token endpoint");

  const expired = signState({ ...readState(started.stateCookie, config.stateSecret, now)!, exp: nowSeconds - 1 }, config.stateSecret);
  await expectFailure(`/callback?code=c&state=${encodeURIComponent(started.state)}`, { cookie: `lpl_google_state=${expired}` }, /expired/u);

  const failing = googleRoutes({ store, config, createSession: () => "tok", fetch: fakeGoogle({ token: () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }) }).request, now: () => now, log: (line) => lines.push(line) });
  const attempt = await start(failing);
  const response = await failing.request(`/callback?code=c&state=${encodeURIComponent(attempt.state)}`, { headers: { host: "localhost:3000", cookie: `lpl_google_state=${attempt.stateCookie}` } });
  assert.equal(response.headers.get("location"), "/account/login?error=google");
  assert.match(lines.at(-1)!, /TOKEN_EXCHANGE: HTTP 400 invalid_grant/u);

  const unverified = googleRoutes({ store, config, createSession: () => "tok", fetch: fakeGoogle({ token: () => new Response(JSON.stringify({ id_token: idToken({ email_verified: false }) })) }).request, now: () => now, log: (line) => lines.push(line) });
  const flow = await start(unverified);
  await unverified.request(`/callback?code=c&state=${encodeURIComponent(flow.state)}`, { headers: { host: "localhost:3000", cookie: `lpl_google_state=${flow.stateCookie}` } });
  assert.match(lines.at(-1)!, /ID_TOKEN_EMAIL_UNVERIFIED/u);
  assert.equal(accounts.size, 0, "no account was created along the way");
});
