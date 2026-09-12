import { bodyExcerpt, classifyStatus, failure, mask, type Channel, type Delivery, type FetchLike, type Target } from "../channel.ts";
import type { Message } from "../message.ts";
import { telegramCaptionLimit, telegramHtml, telegramMessageLimit } from "../render/telegram.ts";

/**
 * Telegram Bot API. A target's address is a chat id: a person's private chat (after they
 * pressed Start), a group, or a channel the bot administers ("-100…" or "@handle"). A message
 * with an image and a short body goes as a photo with a caption; a longer one goes as text
 * with the image shown as a large link preview above it.
 */

export type TelegramConfig = { token: string; fetch?: FetchLike | undefined; apiBase?: string | undefined };

type ApiResult = { ok: boolean; result?: { message_id?: number }; description?: string; error_code?: number; parameters?: { retry_after?: number } };

const goneDescriptions = [/bot was blocked/iu, /chat not found/iu, /user is deactivated/iu, /bot was kicked/iu, /not enough rights/iu, /chat_write_forbidden/iu, /bot is not a member/iu, /have no rights to send/iu];

export function createTelegramChannel(config: TelegramConfig): Channel {
  const request = config.fetch ?? fetch;
  const base = `${config.apiBase ?? "https://api.telegram.org"}/bot${config.token}`;
  const call = async (method: string, body: Record<string, unknown>): Promise<Delivery> => {
    let response: Response;
    try {
      response = await request(`${base}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    } catch (error) {
      return failure(`TELEGRAM_NETWORK: ${error instanceof Error ? error.message : String(error)}`, { retryable: true });
    }
    const payload = (await response.json().catch(() => null)) as ApiResult | null;
    if (response.ok && payload?.ok) return { ok: true, reference: payload.result?.message_id === undefined ? null : String(payload.result.message_id) };
    const description = payload?.description ?? (await bodyExcerpt(response));
    const status = payload?.error_code ?? response.status;
    const classified = classifyStatus(status, response.headers);
    const retryAfter = payload?.parameters?.retry_after;
    return failure(`TELEGRAM_HTTP_${status}: ${description}`, {
      retryable: classified.retryable,
      gone: classified.gone && !/method not found/iu.test(description) ? true : goneDescriptions.some((pattern) => pattern.test(description)),
      retryAfterMs: retryAfter ? Math.min(retryAfter, 3600) * 1000 : classified.retryAfterMs,
    });
  };
  return {
    kind: "telegram",
    describe: (target) => `telegram:${target.address.startsWith("@") ? target.address : mask(target.address, 2)}`,
    send: async (target: Target, message: Message) => {
      const thread = typeof target.meta?.thread_id === "number" ? { message_thread_id: target.meta.thread_id } : {};
      const text = telegramHtml(message, telegramMessageLimit);
      // The whole message fits a caption: one photo post. Otherwise nothing is dropped; the image rides as a large preview.
      if (message.image && text.length <= telegramCaptionLimit) {
        return call("sendPhoto", { chat_id: target.address, photo: message.image.url, caption: text, parse_mode: "HTML", ...thread });
      }
      const preview = message.image ? { link_preview_options: { url: message.image.url, prefer_large_media: true, show_above_text: true } } : { link_preview_options: { is_disabled: true } };
      return call("sendMessage", { chat_id: target.address, text, parse_mode: "HTML", ...preview, ...thread });
    },
  };
}

/** The pieces of an incoming update the application acts on: who wrote, in which chat, and the /start payload when there is one. */
export type TelegramInbound = {
  chatId: string;
  chatType: string;
  text: string;
  /** The token after "/start ", when the update is a deep-link start. */
  startPayload: string | null;
  from: { id: string; username: string | null; firstName: string | null } | null;
};

export function parseTelegramUpdate(update: unknown): TelegramInbound | null {
  if (typeof update !== "object" || update === null) return null;
  const record = update as { message?: unknown; channel_post?: unknown };
  const message = (record.message ?? record.channel_post) as { chat?: { id?: number | string; type?: string }; text?: string; from?: { id?: number; username?: string; first_name?: string } } | undefined;
  if (!message || typeof message !== "object" || message.chat?.id === undefined) return null;
  const text = typeof message.text === "string" ? message.text.trim() : "";
  const start = /^\/start(?:@\w+)?(?:\s+(\S+))?$/u.exec(text);
  return {
    chatId: String(message.chat.id),
    chatType: message.chat.type ?? "unknown",
    text,
    startPayload: start ? (start[1] ?? "") : null,
    from: message.from?.id === undefined ? null : { id: String(message.from.id), username: message.from.username ?? null, firstName: message.from.first_name ?? null },
  };
}

/** "https://t.me/<bot>?start=<payload>": the link a visitor taps to bind their chat to a subscription. Payloads are 1 to 64 characters of [A-Za-z0-9_-]. */
export function telegramDeepLink(botUsername: string, payload: string): string {
  if (!/^[\w-]{1,64}$/u.test(payload)) throw new Error("TELEGRAM_PAYLOAD_INVALID");
  return `https://t.me/${botUsername.replace(/^@/u, "")}?start=${payload}`;
}

/** Points the bot's webhook at `url`; Telegram then posts updates there with the secret in the X-Telegram-Bot-Api-Secret-Token header. */
export async function setTelegramWebhook(config: TelegramConfig, url: string, secret: string): Promise<{ ok: boolean; description: string }> {
  const request = config.fetch ?? fetch;
  const response = await request(`${config.apiBase ?? "https://api.telegram.org"}/bot${config.token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "channel_post"], drop_pending_updates: false }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  return { ok: Boolean(payload?.ok), description: payload?.description ?? `HTTP ${response.status}` };
}

/** The bot's own username and id, for building deep links and checking the token. */
export async function telegramIdentity(config: TelegramConfig): Promise<{ id: string; username: string } | null> {
  const request = config.fetch ?? fetch;
  const response = await request(`${config.apiBase ?? "https://api.telegram.org"}/bot${config.token}/getMe`, { signal: AbortSignal.timeout(20_000) });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: { id?: number; username?: string } } | null;
  if (!payload?.ok || payload.result?.id === undefined || !payload.result.username) return null;
  return { id: String(payload.result.id), username: payload.result.username };
}
