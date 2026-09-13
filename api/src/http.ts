import type { ApiEnvelope } from "@lanka-pricelens/shared";
import type { Context } from "hono";

/** The one response shape every route answers with. */
export function envelope<T>(requestId: string, payload: T, success = true, message = "OK"): ApiEnvelope<T> {
  return { success, message, payload, meta: { request_id: requestId, generated_at: new Date().toISOString() } };
}

/**
 * True when the request comes from this site (or carries no Origin at all, as same-site navigations
 * and non-browser clients do). State-changing routes refuse anything else, which keeps another
 * site's page from driving a signed-in browser.
 */
export function sameOrigin(context: Context): boolean {
  const origin = context.req.header("origin");
  if (!origin) return true;
  let requested: URL;
  try {
    requested = new URL(origin);
  } catch {
    return false;
  }
  const host = context.req.header("x-forwarded-host")?.split(",")[0]?.trim() || context.req.header("host") || new URL(context.req.url).host;
  if (requested.host !== host) return false;
  const protocol = context.req.header("x-forwarded-proto")?.split(",")[0]?.trim();
  return protocol ? requested.protocol === `${protocol}:` : true;
}

/** The request body as a plain object, or null when it is missing, not JSON, or not an object. An empty body counts as `{}`. */
export async function jsonObject(context: Context): Promise<Record<string, unknown> | null> {
  const text = await context.req.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The caller's address as the reverse proxy reports it, for rate limits; "unknown" without one. */
export function clientAddress(context: Context): string {
  return context.req.header("x-forwarded-for")?.split(",")[0]?.trim() || context.req.header("x-real-ip") || "unknown";
}

/** The site's own origin for links in mail and OAuth redirects: configured, or read from the request behind the proxy. */
export function requestOrigin(context: Context, configured?: string | undefined): string {
  if (configured) return configured.replace(/\/+$/u, "");
  const protocol = context.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(context.req.url).protocol.replace(":", "");
  const host = context.req.header("x-forwarded-host")?.split(",")[0]?.trim() || context.req.header("host") || new URL(context.req.url).host;
  return `${protocol}://${host}`;
}
