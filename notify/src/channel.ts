import type { Message } from "./message.ts";

/**
 * A channel delivers one Message to one Target. Targets are addresses in the channel's own
 * terms (a Telegram chat id, a webhook URL, an email address, a push endpoint with its keys);
 * the application owns the table that maps subscribers to targets, the channel only knows how
 * to reach one.
 */

export const channelKinds = ["telegram", "discord", "slack", "email", "webpush"] as const;
export type ChannelKind = (typeof channelKinds)[number];

export function isChannelKind(value: unknown): value is ChannelKind {
  return typeof value === "string" && (channelKinds as readonly string[]).includes(value);
}

export type Target = {
  kind: ChannelKind;
  /** Chat id, webhook URL, email address, or push endpoint. */
  address: string;
  /** Channel-specific extras: push keys (`p256dh`, `auth`), an email display name, a Telegram thread id. */
  meta?: Record<string, unknown> | undefined;
};

export type Delivery =
  | { ok: true; reference: string | null }
  | {
      ok: false;
      /** Short machine-readable code with detail: "TELEGRAM_HTTP_429: Too Many Requests". */
      error: string;
      /** A later attempt may succeed (rate limit, outage). */
      retryable: boolean;
      /** The target no longer exists or refused us for good (blocked bot, expired push subscription, deleted webhook); the caller should disable it. */
      gone: boolean;
      /** The provider's own wait hint, when it gave one. */
      retryAfterMs?: number | undefined;
    };

export type Channel = {
  kind: ChannelKind;
  /** The address with its secret parts masked, for logs and the admin. */
  describe: (target: Target) => string;
  send: (target: Target, message: Message) => Promise<Delivery>;
};

export type FetchLike = typeof fetch;

export function failure(error: string, options: { retryable?: boolean; gone?: boolean; retryAfterMs?: number | undefined } = {}): Delivery {
  return { ok: false, error, retryable: options.retryable ?? false, gone: options.gone ?? false, retryAfterMs: options.retryAfterMs };
}

/** The usual reading of an HTTP status: 429 and 5xx are worth another try, 404 and 410 mean the address is dead. */
export function classifyStatus(status: number, headers?: Headers): { retryable: boolean; gone: boolean; retryAfterMs: number | undefined } {
  const retryAfter = headers?.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  return {
    retryable: status === 408 || status === 429 || status >= 500,
    gone: status === 404 || status === 410,
    retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : undefined,
  };
}

/** Reads a response body for an error message without ever throwing. */
export async function bodyExcerpt(response: Response, limit = 200): Promise<string> {
  try {
    return (await response.text()).replace(/\s+/gu, " ").trim().slice(0, limit);
  } catch {
    return "";
  }
}

/** "abcd…wxyz" for a token, webhook path, or endpoint, keeping enough to recognise it. */
export function mask(value: string, keep = 4): string {
  if (value.length <= keep * 2 + 1) return "…";
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
