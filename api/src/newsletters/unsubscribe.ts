import { createHmac, timingSafeEqual } from "node:crypto";

import { escapeHtml } from "@lanka-pricelens/notify";
import { Hono, type Context } from "hono";

import type { AccountStore } from "../account/types.ts";
import { envelope } from "../http.ts";
import { isNewsletterKind, type NewsletterKind } from "./store.ts";

/**
 * One-click unsubscribe without a session: the link in every newsletter carries a token that
 * names the account and the kind and is signed with the account state secret. GET answers a
 * small page for a person who clicked; POST answers 200 for a mail client that followed the
 * List-Unsubscribe-Post header. Both switch the kind's preference off; nothing else on the
 * account changes and the token reveals nothing a stranger could use.
 */

/** Which preference each newsletter kind switches. */
export const preferenceOf: Record<NewsletterKind, "notify_recipes" | "notify_digest"> = { recipes_daily: "notify_recipes", deals_daily: "notify_digest" };

const wording: Record<NewsletterKind, string> = { recipes_daily: "daily recipe ideas", deals_daily: "the daily deals mail" };

function signature(secret: string, accountId: string, kind: NewsletterKind): string {
  return createHmac("sha256", secret).update(`${accountId}:${kind}`).digest("hex");
}

/** base64url(account_id:kind:hmac-sha256(secret, account_id:kind)). */
export function signUnsubscribeToken(secret: string, accountId: string, kind: NewsletterKind): string {
  return Buffer.from(`${accountId}:${kind}:${signature(secret, accountId, kind)}`, "utf8").toString("base64url");
}

/** The account and kind a token names, or null when it is malformed or its signature does not match. */
export function verifyUnsubscribeToken(secret: string, token: string): { accountId: string; kind: NewsletterKind } | null {
  if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(token)) return null;
  const parts = Buffer.from(token, "base64url").toString("utf8").split(":");
  if (parts.length !== 3) return null;
  const [accountId = "", kind = "", given = ""] = parts;
  if (!accountId || !isNewsletterKind(kind)) return null;
  const expected = Buffer.from(signature(secret, accountId, kind), "utf8");
  const provided = Buffer.from(given, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;
  return { accountId, kind };
}

export const unsubscribePath = "/v1/newsletter/unsubscribe";

export function unsubscribeUrl(siteOrigin: string, secret: string, accountId: string, kind: NewsletterKind): string {
  return `${siteOrigin.replace(/\/+$/u, "")}${unsubscribePath}?token=${signUnsubscribeToken(secret, accountId, kind)}`;
}

export type UnsubscribeDeps = {
  store: AccountStore;
  /** LPL_ACCOUNT_STATE_SECRET: the key the tokens are signed with. */
  secret: string;
  /** Where the page's "back to the site" link goes; the request's own origin when null. */
  siteOrigin?: string | null | undefined;
  now?: (() => Date) | undefined;
};

export type UnsubscribeBindings = { Variables: { requestId: string } };

function page(title: string, body: string, siteOrigin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · PriceLens</title>
</head>
<body style="margin:0;padding:48px 16px;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2420;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e7e4;border-radius:12px;padding:32px 28px;">
<p style="margin:0 0 16px 0;font-size:18px;font-weight:700;">PriceLens</p>
<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px 0;font-size:16px;line-height:1.55;">${body}</p>
<p style="margin:0;font-size:14px;"><a href="${escapeHtml(siteOrigin)}/account" style="color:#007f52;">Notification settings</a> · <a href="${escapeHtml(siteOrigin)}/" style="color:#007f52;">Back to the site</a></p>
</div>
</body>
</html>
`;
}

export function unsubscribeRoutes(deps: UnsubscribeDeps): Hono<UnsubscribeBindings> {
  const app = new Hono<UnsubscribeBindings>();
  const clock = deps.now ?? (() => new Date());

  /** Switches the kind off for the token's account; true when the token was good, whether or not the account still exists. */
  const apply = (context: Context<UnsubscribeBindings>): { ok: true; kind: NewsletterKind } | { ok: false } => {
    const verified = verifyUnsubscribeToken(deps.secret, (context.req.query("token") ?? "").trim());
    if (!verified) return { ok: false };
    const account = deps.store.findAccountById(verified.accountId);
    const key = preferenceOf[verified.kind];
    if (account && account.preferences[key]) deps.store.updateAccount(account.id, { preferences: { ...account.preferences, [key]: false } }, clock());
    return { ok: true, kind: verified.kind };
  };

  const originOf = (context: Context<UnsubscribeBindings>): string => {
    if (deps.siteOrigin) return deps.siteOrigin.replace(/\/+$/u, "");
    const url = new URL(context.req.url);
    const protocol = context.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
    const host = context.req.header("x-forwarded-host")?.split(",")[0]?.trim() || context.req.header("host") || url.host;
    return `${protocol}://${host}`;
  };

  app.get("/", (context) => {
    const result = apply(context);
    context.header("Cache-Control", "no-store");
    if (!result.ok) return context.html(page("This link is not valid", "The unsubscribe link is incomplete or has been altered. Open the newest mail and use its link, or change your notifications on your account page.", originOf(context)), 400);
    return context.html(page("You're unsubscribed", `You won't get ${escapeHtml(wording[result.kind])} from PriceLens any more. Switch it back on any time under Notifications on your account page.`, originOf(context)));
  });

  // The one-click form a mail client posts (RFC 8058): the token is in the query, the body says List-Unsubscribe=One-Click.
  app.post("/", (context) => {
    const result = apply(context);
    context.header("Cache-Control", "no-store");
    if (!result.ok) return context.json(envelope(context.get("requestId") ?? "unknown", null, false, "Invalid unsubscribe token"), 400);
    return context.json(envelope(context.get("requestId") ?? "unknown", { kind: result.kind, unsubscribed: true }, true, "Unsubscribed"));
  });

  return app;
}
