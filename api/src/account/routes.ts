import { changeEmailSchema, changePasswordSchema, deleteAccountSchema, forgotPasswordSchema, loginSchema, profilePatchSchema, registerSchema, resetPasswordSchema, verifyEmailSchema } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { RateLimiter } from "../feedback.ts";
import { clientAddress, envelope, jsonObject, requestOrigin, sameOrigin } from "../http.ts";
import { accountFailure, requireAccount, sessionCookieOptions, type AccountEnv } from "./middleware.ts";
import type { AccountService, SessionMeta, SignedIn } from "./service.ts";
import { AccountError, type AccountConfig, type AccountErrorCode, type AccountStore } from "./types.ts";

/**
 * The account routes, mounted by app.ts at /v1/account. Bodies are validated with the shared
 * schemas, anything that changes state must come from the site's own origin, and the routes a
 * stranger can hit (register, sign in, forgot, resend) keep a per-address budget. Failures carry
 * a `code` next to the usual envelope so the site can word them.
 */

export type AccountRateLimits = Partial<Record<"register" | "login" | "forgot" | "resend", RateLimiter>>;

export type AccountRoutesDeps = { store: AccountStore; service: AccountService; config: AccountConfig; rateLimits?: AccountRateLimits | undefined };

/** Five tries per address in fifteen minutes on the routes anyone can call. */
export const defaultRateLimit = () => new RateLimiter(5, 15 * 60_000);

const statusOf: Record<AccountErrorCode, 400 | 401 | 403 | 404 | 409 | 423 | 429> = {
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_LOCKED: 423,
  ACCOUNT_DISABLED: 403,
  TOKEN_INVALID: 400,
  PASSWORD_REQUIRED: 400,
  PASSWORD_WRONG: 403,
  EMAIL_NOT_VERIFIED: 403,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
};

/** The part of a zod schema the routes use; typed structurally because zod is the shared package's dependency, not this one's. */
type BodySchema = {
  parse: (input: unknown) => unknown;
  safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } };
};
type Output<S extends BodySchema> = ReturnType<S["parse"]>;

type Ctx = Context<AccountEnv>;

const requestIdOf = (context: Ctx): string => context.get("requestId") ?? "unknown";

const ok = (context: Ctx, payload: unknown, message = "OK", status: 200 | 201 = 200) => context.json(envelope(requestIdOf(context), payload, true, message), status);

/** The validated body, or the 400 answer to send instead: the first issue as the message, all of them in the payload. */
async function parseBody<S extends BodySchema>(context: Ctx, schema: S): Promise<{ ok: true; data: Output<S> } | { ok: false; response: Response }> {
  const body = await jsonObject(context);
  if (!body) return { ok: false, response: context.json(envelope(requestIdOf(context), null, false, "Body must be a JSON object"), 400) };
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = (result.error?.issues ?? []).map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
    return { ok: false, response: context.json(envelope(requestIdOf(context), { issues }, false, issues[0]?.message ?? "Invalid request"), 400) };
  }
  return { ok: true, data: result.data as Output<S> };
}

/** Turns a service failure into its answer; anything else is a bug and goes to the app's error handler. */
function failed(context: Ctx, error: unknown): Response {
  if (!(error instanceof AccountError)) throw error;
  if (error.code === "ACCOUNT_LOCKED" && error.retryAfterSeconds !== undefined) {
    context.header("Retry-After", String(error.retryAfterSeconds));
    return accountFailure(context, 423, error.code, error.message, { retry_after_seconds: error.retryAfterSeconds });
  }
  return accountFailure(context, statusOf[error.code], error.code, error.message);
}

function sessionMeta(context: Ctx): SessionMeta {
  const address = clientAddress(context);
  return { userAgent: context.req.header("user-agent")?.slice(0, 300) ?? null, address: address === "unknown" ? null : address };
}

export function accountRoutes(deps: AccountRoutesDeps): Hono<AccountEnv> {
  const { store, service, config } = deps;
  const limits = {
    register: deps.rateLimits?.register ?? defaultRateLimit(),
    login: deps.rateLimits?.login ?? defaultRateLimit(),
    forgot: deps.rateLimits?.forgot ?? defaultRateLimit(),
    resend: deps.rateLimits?.resend ?? defaultRateLimit(),
  };
  const guard = requireAccount(store, config);
  const origin = (context: Ctx) => requestOrigin(context, config.siteOrigin ?? undefined);
  const budget = (context: Ctx, limiter: RateLimiter): Response | undefined =>
    limiter.allow(clientAddress(context)) ? undefined : accountFailure(context, 429, "RATE_LIMITED", "Too many attempts from this connection; please try again in a few minutes");
  const setSession = (context: Ctx, signedIn: SignedIn) => setCookie(context, config.cookieName, signedIn.sessionToken, sessionCookieOptions(config, signedIn.ttlSeconds));
  const clearSession = (context: Ctx) => deleteCookie(context, config.cookieName, { path: "/", secure: config.secureCookies });

  const app = new Hono<AccountEnv>();
  app.use("*", bodyLimit({ maxSize: 16 * 1024 }));
  app.use("*", async (context, next) => {
    const method = context.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && !sameOrigin(context)) {
      return context.json(envelope(requestIdOf(context), null, false, "Cross-origin request rejected"), 403);
    }
    await next();
  });

  app.post("/register", async (context) => {
    const body = await parseBody(context, registerSchema);
    if (!body.ok) return body.response;
    const limited = budget(context, limits.register);
    if (limited) return limited;
    try {
      const signedIn = await service.register({ email: body.data.email, password: body.data.password, displayName: body.data.display_name }, sessionMeta(context), origin(context));
      setSession(context, signedIn);
      return ok(context, signedIn.profile, "Welcome; check your inbox to verify the address", 201);
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/login", async (context) => {
    const body = await parseBody(context, loginSchema);
    if (!body.ok) return body.response;
    // Sign-in counts failures only: many Sri Lankan connections share one address, and a household's
    // successful sign-ins must not lock a neighbour out.
    if (limits.login.exhausted(clientAddress(context))) return accountFailure(context, 429, "RATE_LIMITED", "Too many attempts from this connection; please try again in a few minutes");
    try {
      const signedIn = await service.login(body.data, sessionMeta(context));
      setSession(context, signedIn);
      return ok(context, signedIn.profile, "Signed in");
    } catch (error) {
      if (error instanceof AccountError && (error.code === "INVALID_CREDENTIALS" || error.code === "ACCOUNT_LOCKED")) limits.login.allow(clientAddress(context));
      return failed(context, error);
    }
  });

  app.post("/logout", guard, (context) => {
    service.logout(getCookie(context, config.cookieName) ?? "");
    clearSession(context);
    return ok(context, null, "Signed out");
  });

  app.get("/me", guard, (context) => ok(context, service.profile(context.get("account"))));

  app.patch("/me", guard, async (context) => {
    const body = await parseBody(context, profilePatchSchema);
    if (!body.ok) return body.response;
    try {
      return ok(context, service.updateProfile(context.get("account").id, body.data), "Profile saved");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.delete("/me", guard, async (context) => {
    const body = await parseBody(context, deleteAccountSchema);
    if (!body.ok) return body.response;
    try {
      await service.deleteAccount(context.get("account").id, body.data.password);
      clearSession(context);
      return ok(context, null, "Account deleted");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/verify-email", async (context) => {
    const body = await parseBody(context, verifyEmailSchema);
    if (!body.ok) return body.response;
    try {
      const { account, profile } = await service.verifyEmail(body.data.token, origin(context));
      // The link may be opened in a browser that is not signed in; verifying proves the address, so it signs in too.
      if (!store.findSession(getCookie(context, config.cookieName) ?? "", new Date())) setSession(context, service.signIn(account, sessionMeta(context)));
      return ok(context, profile, "Email address verified");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/resend-verification", guard, async (context) => {
    const limited = budget(context, limits.resend);
    if (limited) return limited;
    try {
      await service.resendVerification(context.get("account").id, origin(context));
      return ok(context, null, "Verification mail sent");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/forgot-password", async (context) => {
    const body = await parseBody(context, forgotPasswordSchema);
    if (!body.ok) return body.response;
    const limited = budget(context, limits.forgot);
    if (limited) return limited;
    await service.forgotPassword(body.data.email, origin(context));
    return ok(context, null, "If that address has an account, a reset link is on its way");
  });

  app.post("/reset-password", async (context) => {
    const body = await parseBody(context, resetPasswordSchema);
    if (!body.ok) return body.response;
    try {
      const { account, profile } = await service.resetPassword(body.data.token, body.data.password, origin(context));
      setSession(context, service.signIn(account, sessionMeta(context)));
      return ok(context, profile, "Password changed");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/change-password", guard, async (context) => {
    const body = await parseBody(context, changePasswordSchema);
    if (!body.ok) return body.response;
    try {
      await service.changePassword(context.get("account").id, body.data.current_password, body.data.new_password, context.get("sessionTokenHash"), origin(context));
      return ok(context, null, "Password changed");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/change-email", guard, async (context) => {
    const body = await parseBody(context, changeEmailSchema);
    if (!body.ok) return body.response;
    try {
      await service.changeEmail(context.get("account").id, body.data.new_email, body.data.password, origin(context));
      return ok(context, null, "Check the new address for a confirmation link");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.post("/confirm-email", async (context) => {
    const body = await parseBody(context, verifyEmailSchema);
    if (!body.ok) return body.response;
    try {
      const { profile } = await service.confirmEmail(body.data.token, origin(context));
      return ok(context, profile, "Email address changed");
    } catch (error) {
      return failed(context, error);
    }
  });

  app.get("/sessions", guard, (context) => ok(context, service.listSessions(context.get("account").id, context.get("sessionTokenHash"))));

  app.post("/sessions/revoke-others", guard, (context) => {
    const revoked = service.revokeOtherSessions(context.get("account").id, context.get("sessionTokenHash"));
    return ok(context, { revoked }, revoked === 1 ? "One other session signed out" : `${revoked} other sessions signed out`);
  });

  return app;
}
