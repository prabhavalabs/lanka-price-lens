import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { clientAddress, requestOrigin } from "../http.ts";
import type { Account, AccountConfig, AccountStore, GoogleProfile } from "./types.ts";
import type { AccountLocale } from "@lanka-pricelens/shared";

/**
 * Sign in with Google: OAuth 2.0 authorization code with PKCE, all on the server, no library.
 * `/start` sends the browser to Google with a state and a code challenge kept in a signed,
 * short-lived cookie; `/callback` checks the state, trades the code for tokens, verifies the
 * ID token against Google's published keys, and finds or creates the account. Every failure
 * ends at the login page with `?error=google`; the log has the reason.
 */

export const googleAuthorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
export const googleTokenEndpoint = "https://oauth2.googleapis.com/token";
export const googleCertsEndpoint = "https://www.googleapis.com/oauth2/v3/certs";
/** Where Google sends the browser back, under the site's origin; the app mounts these routes at `/v1/auth/google`. */
export const googleCallbackPath = "/v1/auth/google/callback";
export const stateCookieName = "lpl_google_state";
export const loginErrorPath = "/account/login?error=google";
const stateSeconds = 10 * 60;
/** Clock drift we forgive when checking a token's expiry. */
const leewaySeconds = 30;

type FetchLike = typeof fetch;

export class GoogleSignInError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export function buildAuthorizationUrl(input: { clientId: string; redirectUri: string; state: string; codeChallenge: string; loginHint?: string | undefined }): string {
  const url = new URL(googleAuthorizationEndpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  if (input.loginHint) url.searchParams.set("login_hint", input.loginHint);
  return url.toString();
}

/** A fresh PKCE verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * Where to send the browser after sign-in: a path on this site, never another origin. Anything
 * that is not a plain path (a scheme, a protocol-relative `//host`, a backslash, control
 * characters or whitespace, the API itself) falls back to the home page.
 */
export function parseReturnTo(value: string | null | undefined, fallback = "/"): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.length > 2000) return fallback;
  if (/[\\\s]/u.test(trimmed)) return fallback;
  for (const char of trimmed) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return fallback;
  }
  if (trimmed === "/v1" || trimmed.startsWith("/v1/")) return fallback;
  return trimmed;
}

export type StatePayload = { state: string; verifier: string; return_to: string; exp: number };

/** The state cookie: the payload as base64url JSON, then an HMAC-SHA256 over it, so it cannot be forged or altered. */
export function signState(payload: StatePayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export function readState(cookie: string | undefined, secret: string, now = new Date()): StatePayload | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = cookie.slice(0, dot);
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(createHmac("sha256", secret).update(body).digest("base64url"));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<StatePayload> | null;
    if (!parsed || typeof parsed.state !== "string" || typeof parsed.verifier !== "string" || typeof parsed.return_to !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp * 1000 <= now.getTime()) return null;
    return { state: parsed.state, verifier: parsed.verifier, return_to: parsed.return_to, exp: parsed.exp };
  } catch {
    return null;
  }
}

export type GoogleJwk = { kid: string; kty: string; n: string; e: string; alg?: string | undefined; use?: string | undefined };

function isJwk(value: unknown): value is GoogleJwk {
  if (typeof value !== "object" || !value) return false;
  const key = value as Record<string, unknown>;
  return typeof key.kid === "string" && key.kty === "RSA" && typeof key.n === "string" && typeof key.e === "string";
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Checks an ID token the way Google documents it: RS256 signature against one of the given
 * keys, issuer, audience (our client id), expiry, and a verified email. Returns what we keep
 * of the person; throws a GoogleSignInError naming what failed.
 */
export function verifyIdToken(token: string, options: { clientId: string; keys: GoogleJwk[]; now?: Date | undefined }): GoogleProfile {
  const parts = token.split(".");
  if (parts.length !== 3) throw new GoogleSignInError("ID_TOKEN_MALFORMED");
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = decodeJson(headerPart);
  const payload = decodeJson(payloadPart);
  if (!header || !payload) throw new GoogleSignInError("ID_TOKEN_MALFORMED");
  if (header.alg !== "RS256") throw new GoogleSignInError("ID_TOKEN_ALGORITHM", String(header.alg));
  const key = options.keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new GoogleSignInError("ID_TOKEN_KEY_UNKNOWN", String(header.kid));
  const publicKey = createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: "jwk" });
  const signature = Buffer.from(signaturePart, "base64url");
  if (!signature.length || !verifySignature("sha256", Buffer.from(`${headerPart}.${payloadPart}`), publicKey, signature)) throw new GoogleSignInError("ID_TOKEN_SIGNATURE");
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") throw new GoogleSignInError("ID_TOKEN_ISSUER", String(payload.iss));
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(options.clientId)) throw new GoogleSignInError("ID_TOKEN_AUDIENCE");
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  if (typeof payload.exp !== "number" || payload.exp + leewaySeconds <= now) throw new GoogleSignInError("ID_TOKEN_EXPIRED");
  if (typeof payload.sub !== "string" || !payload.sub) throw new GoogleSignInError("ID_TOKEN_SUBJECT");
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!email) throw new GoogleSignInError("ID_TOKEN_EMAIL");
  if (payload.email_verified !== true && payload.email_verified !== "true") throw new GoogleSignInError("ID_TOKEN_EMAIL_UNVERIFIED");
  return {
    subject: payload.sub,
    email,
    email_verified: true,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : null,
    picture: typeof payload.picture === "string" && /^https:\/\//u.test(payload.picture) ? payload.picture : null,
    locale: typeof payload.locale === "string" && payload.locale ? payload.locale : null,
  };
}

export type GoogleKeySource = (options?: { refresh?: boolean | undefined }) => Promise<GoogleJwk[]>;

function maxAgeMs(header: string | null): number {
  const match = /max-age=(\d+)/iu.exec(header ?? "");
  const seconds = match ? Number(match[1]) : 0;
  return Math.min(Math.max(seconds, 60), 24 * 3600) * 1000;
}

/**
 * Google's signing keys, fetched once and kept for as long as the Cache-Control header allows.
 * A refresh (for a key id we do not know, after a rotation) is honoured at most once a minute
 * so a flood of bad tokens cannot turn into a flood of requests to Google.
 */
export function googleKeySource(request: FetchLike = fetch, options: { endpoint?: string | undefined; clock?: (() => number) | undefined } = {}): GoogleKeySource {
  const endpoint = options.endpoint ?? googleCertsEndpoint;
  const clock = options.clock ?? Date.now;
  let cached: { keys: GoogleJwk[]; fetchedAt: number; expiresAt: number } | null = null;
  let inflight: Promise<GoogleJwk[]> | null = null;
  const load = async (): Promise<GoogleJwk[]> => {
    const response = await request(endpoint, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new GoogleSignInError("CERTS_UNAVAILABLE", `HTTP ${response.status}`);
    const body = (await response.json()) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.filter(isJwk) : [];
    const fetchedAt = clock();
    cached = { keys, fetchedAt, expiresAt: fetchedAt + maxAgeMs(response.headers.get("cache-control")) };
    return keys;
  };
  return async (options = {}) => {
    const now = clock();
    if (cached && (options.refresh ? now - cached.fetchedAt < 60_000 : now < cached.expiresAt)) return cached.keys;
    inflight ??= load().finally(() => {
      inflight = null;
    });
    return inflight;
  };
}

/** Verifies with the cached keys, fetching them again once when the token names a key we have not seen. */
export async function verifyWithGoogleKeys(token: string, clientId: string, keys: GoogleKeySource, now = new Date()): Promise<GoogleProfile> {
  try {
    return verifyIdToken(token, { clientId, keys: await keys(), now });
  } catch (error) {
    if (!(error instanceof GoogleSignInError) || error.code !== "ID_TOKEN_KEY_UNKNOWN") throw error;
    return verifyIdToken(token, { clientId, keys: await keys({ refresh: true }), now });
  }
}

async function exchangeCode(request: FetchLike, input: { code: string; clientId: string; clientSecret: string; redirectUri: string; verifier: string }): Promise<string> {
  const form = new URLSearchParams({ code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code", code_verifier: input.verifier });
  let response: Response;
  try {
    response = await request(googleTokenEndpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form.toString(), signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new GoogleSignInError("TOKEN_NETWORK", error instanceof Error ? error.message : String(error));
  }
  const payload = (await response.json().catch(() => null)) as { id_token?: unknown; error?: unknown } | null;
  if (!response.ok || !payload || typeof payload.id_token !== "string") throw new GoogleSignInError("TOKEN_EXCHANGE", `HTTP ${response.status}${payload && typeof payload.error === "string" ? ` ${payload.error}` : ""}`);
  return payload.id_token;
}

function localeFrom(value: string | null): AccountLocale | undefined {
  const primary = value?.split(/[-_]/u)[0]?.toLowerCase();
  return primary === "en" || primary === "si" || primary === "ta" ? primary : undefined;
}

function displayNameFrom(profile: GoogleProfile): string {
  const name = profile.name ?? profile.email.split("@")[0] ?? "";
  return (name.trim() || "Reader").slice(0, 80);
}

/**
 * The account behind a Google profile: the one already linked to this Google subject, else the
 * one with the same address (linked now, and marked verified since Google vouches for the
 * address), else a new one, verified from the start.
 */
export function resolveAccount(store: AccountStore, profile: GoogleProfile, now: Date): Account {
  const identity = store.findIdentity("google", profile.subject);
  if (identity) {
    const linked = store.findAccountById(identity.account_id);
    if (linked) return linked;
  }
  const existing = store.findAccountByEmail(profile.email);
  if (existing) {
    store.linkIdentity({ provider: "google", subject: profile.subject, account_id: existing.id, email: profile.email }, now);
    return existing.email_verified_at ? existing : store.updateAccount(existing.id, { email_verified_at: now.toISOString() }, now);
  }
  const created = store.createAccount({ email: profile.email, passwordHash: null, displayName: displayNameFrom(profile), locale: localeFrom(profile.locale), avatarUrl: profile.picture, emailVerified: true }, now);
  store.linkIdentity({ provider: "google", subject: profile.subject, account_id: created.id, email: profile.email }, now);
  return created;
}

export type GoogleRouteDeps = {
  store: AccountStore;
  config: AccountConfig;
  /** Opens a session for the account and returns the raw token; the route puts it in the session cookie. */
  createSession: (accountId: string, meta: { userAgent: string | null; address: string | null }) => string;
  fetch?: FetchLike | undefined;
  now?: (() => Date) | undefined;
  log?: ((line: string) => void) | undefined;
};

/** The two routes, to be mounted at `/v1/auth/google`. */
export function googleRoutes(deps: GoogleRouteDeps): Hono {
  const request = deps.fetch ?? fetch;
  const keys = googleKeySource(request);
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.warn(line));
  const app = new Hono();

  app.get("/start", (context) => {
    const google = deps.config.google;
    if (!google) {
      log("google sign-in refused: LPL_GOOGLE_CLIENT_ID and LPL_GOOGLE_CLIENT_SECRET are not set");
      return context.redirect(loginErrorPath, 302);
    }
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(24).toString("base64url");
    const exp = Math.floor(now().getTime() / 1000) + stateSeconds;
    const payload: StatePayload = { state, verifier, return_to: parseReturnTo(context.req.query("return_to")), exp };
    setCookie(context, stateCookieName, signState(payload, deps.config.stateSecret), { httpOnly: true, sameSite: "Lax", secure: deps.config.secureCookies, path: "/", maxAge: stateSeconds });
    const origin = requestOrigin(context, deps.config.siteOrigin ?? undefined);
    return context.redirect(buildAuthorizationUrl({ clientId: google.clientId, redirectUri: `${origin}${googleCallbackPath}`, state, codeChallenge: challenge }), 302);
  });

  app.get("/callback", async (context) => {
    const failed = (reason: string) => {
      log(`google sign-in failed: ${reason}`);
      return context.redirect(loginErrorPath, 302);
    };
    const saved = readState(getCookie(context, stateCookieName), deps.config.stateSecret, now());
    deleteCookie(context, stateCookieName, { path: "/" });
    const google = deps.config.google;
    if (!google) return failed("not configured");
    if (!saved) return failed("state cookie missing, altered, or expired");
    const state = Buffer.from(context.req.query("state") ?? "");
    const expected = Buffer.from(saved.state);
    if (state.length !== expected.length || !timingSafeEqual(state, expected)) return failed("state mismatch");
    const denied = context.req.query("error");
    if (denied) return failed(`google answered ${denied}`);
    const code = context.req.query("code");
    if (!code) return failed("no code in the callback");
    const origin = requestOrigin(context, deps.config.siteOrigin ?? undefined);
    let account: Account;
    try {
      const idToken = await exchangeCode(request, { code, clientId: google.clientId, clientSecret: google.clientSecret, redirectUri: `${origin}${googleCallbackPath}`, verifier: saved.verifier });
      const profile = await verifyWithGoogleKeys(idToken, google.clientId, keys, now());
      account = resolveAccount(deps.store, profile, now());
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error));
    }
    if (account.status === "disabled") return failed(`account ${account.id} is disabled`);
    const token = deps.createSession(account.id, { userAgent: context.req.header("user-agent") ?? null, address: clientAddress(context) });
    setCookie(context, deps.config.cookieName, token, { httpOnly: true, sameSite: "Lax", secure: deps.config.secureCookies, path: "/", maxAge: deps.config.sessionSeconds });
    return context.redirect(saved.return_to, 302);
  });

  return app;
}
