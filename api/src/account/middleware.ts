import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

import { envelope } from "../http.ts";
import type { Account, AccountConfig, AccountErrorCode, AccountStore } from "./types.ts";

/**
 * Who is asking. `requireAccount` turns the session cookie into an account on the context (401
 * with a code otherwise), `requireVerified` also needs a verified address (403), and `readAccount`
 * sets the account when there is one and never refuses. Remember-me sessions renew as they are
 * used: once more than half the window has passed, the expiry moves out again and the cookie
 * is re-issued to match.
 */

export type AccountVariables = { account: Account; sessionTokenHash: string };
/** The bindings of any Hono app that uses these middlewares; `requestId` is set by app.ts for every request. */
export type AccountEnv = { Variables: AccountVariables & { requestId: string } };

type Resolution = { ok: true; account: Account; tokenHash: string } | { ok: false; status: 401 | 403; code: AccountErrorCode; message: string };

/** Answers a failed check with the usual envelope plus the code. */
export function accountFailure(context: Context<AccountEnv>, status: 401 | 403 | 404 | 409 | 423 | 429 | 400, code: AccountErrorCode, message: string, payload: unknown = null) {
  return context.json({ ...envelope(context.get("requestId") ?? "unknown", payload, false, message), code }, status);
}

function resolveSession(context: Context<AccountEnv>, store: AccountStore, config: AccountConfig, now: Date): Resolution {
  const token = getCookie(context, config.cookieName);
  const found = token ? store.findSession(token, now) : undefined;
  if (!token || !found) return { ok: false, status: 401, code: "INVALID_CREDENTIALS", message: "Sign in to continue" };
  if (found.account.status === "disabled") return { ok: false, status: 403, code: "ACCOUNT_DISABLED", message: "This account is disabled" };
  const { session } = found;
  const windowMs = config.sessionSeconds * 1_000;
  const lifetimeMs = new Date(session.expires_at).getTime() - new Date(session.created_at).getTime();
  const remainingMs = new Date(session.expires_at).getTime() - now.getTime();
  // Only remember-me sessions slide; a short session ends when it was told to.
  if (lifetimeMs >= windowMs && remainingMs < windowMs / 2) {
    store.extendSession(session.token_hash, new Date(now.getTime() + windowMs));
    setCookie(context, config.cookieName, token, sessionCookieOptions(config, config.sessionSeconds));
  }
  return { ok: true, account: found.account, tokenHash: session.token_hash };
}

/** The cookie the session travels in; `maxAge` is the session length so the browser forgets it when the server does. */
export function sessionCookieOptions(config: AccountConfig, maxAge: number) {
  return { httpOnly: true, sameSite: "Lax" as const, secure: config.secureCookies, path: "/", maxAge };
}

/** Sets the account when the cookie names a live session; a request without one goes through untouched. */
export function readAccount(store: AccountStore, config: AccountConfig): MiddlewareHandler<AccountEnv> {
  return async (context, next) => {
    const resolved = resolveSession(context, store, config, new Date());
    if (resolved.ok) {
      context.set("account", resolved.account);
      context.set("sessionTokenHash", resolved.tokenHash);
    }
    await next();
  };
}

/** Needs a live session: 401 `INVALID_CREDENTIALS` without one, 403 `ACCOUNT_DISABLED` for a disabled account. */
export function requireAccount(store: AccountStore, config: AccountConfig): MiddlewareHandler<AccountEnv> {
  return async (context, next) => {
    const resolved = resolveSession(context, store, config, new Date());
    if (!resolved.ok) return accountFailure(context, resolved.status, resolved.code, resolved.message);
    context.set("account", resolved.account);
    context.set("sessionTokenHash", resolved.tokenHash);
    await next();
  };
}

/** `requireAccount`, and the address must be verified: 403 `EMAIL_NOT_VERIFIED` otherwise. */
export function requireVerified(store: AccountStore, config: AccountConfig): MiddlewareHandler<AccountEnv> {
  return async (context, next) => {
    const resolved = resolveSession(context, store, config, new Date());
    if (!resolved.ok) return accountFailure(context, resolved.status, resolved.code, resolved.message);
    if (resolved.account.email_verified_at === null) return accountFailure(context, 403, "EMAIL_NOT_VERIFIED", "Verify your email address to continue");
    context.set("account", resolved.account);
    context.set("sessionTokenHash", resolved.tokenHash);
    await next();
  };
}
