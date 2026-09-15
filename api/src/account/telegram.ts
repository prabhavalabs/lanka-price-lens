import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { message, parseTelegramUpdate, sendDirect, setTelegramWebhook, telegramDeepLink, telegramIdentity, type ChannelRegistry, type FetchLike } from "@lanka-pricelens/notify";
import type { TelegramLink, TelegramLinkStart, TelegramStatus } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import { envelope, sameOrigin } from "../http.ts";
import type { Account, AccountErrorCode, AccountStore } from "./types.ts";

/**
 * Telegram on the account (docs/accounts.md): a person presses "Connect Telegram" on their
 * account page, which opens the bot with a short-lived code; the bot's /start hands the code
 * to the webhook here, which binds that chat to the account. From then on the daily mails
 * and price alerts the person has switched on also arrive in the chat (the newsletter
 * service reads the same rows), until /stop in the chat or Disconnect on the page.
 */

export const telegramCodeMinutes = 15;
export const telegramWebhookPath = "/v1/telegram/webhook";

export type TelegramStore = {
  get: (accountId: string) => TelegramLink | undefined;
  byChat: (chatId: string) => { account_id: string } & TelegramLink | undefined;
  /** Binds the chat to the account; a chat bound to another account moves, an account with another chat is replaced. */
  link: (accountId: string, chat: { chat_id: string; username: string | null; first_name: string | null }, now: Date) => TelegramLink;
  unlink: (accountId: string) => boolean;
  unlinkChat: (chatId: string) => string | null;
  /** A fresh code for the account; earlier codes of the account are dropped. */
  createCode: (accountId: string, now: Date) => { code: string; expires_at: string };
  /** The account behind a live code, consuming it; null when unknown or expired. */
  consumeCode: (code: string, now: Date) => string | null;
  /** The chat ids of the given accounts, for the newsletter run. */
  chatsFor: (accountIds: string[]) => Map<string, string>;
};

type LinkRow = { account_id: string; chat_id: string; username: string | null; first_name: string | null; linked_at: string };

const toLink = (row: LinkRow): TelegramLink => ({ chat_id: row.chat_id, username: row.username, first_name: row.first_name, linked_at: row.linked_at });

export function createTelegramStore(database: OperationalDatabase): TelegramStore {
  const get = (accountId: string) => {
    const row = database.prepare("SELECT account_id, chat_id, username, first_name, linked_at FROM account_telegram WHERE account_id = ?").get(accountId) as LinkRow | undefined;
    return row ? toLink(row) : undefined;
  };
  return {
    get,
    byChat: (chatId) => {
      const row = database.prepare("SELECT account_id, chat_id, username, first_name, linked_at FROM account_telegram WHERE chat_id = ?").get(chatId) as LinkRow | undefined;
      return row ? { account_id: row.account_id, ...toLink(row) } : undefined;
    },
    link: (accountId, chat, now) => {
      database.prepare("DELETE FROM account_telegram WHERE chat_id = ? OR account_id = ?").run(chat.chat_id, accountId);
      database.prepare("INSERT INTO account_telegram (account_id, chat_id, username, first_name, linked_at) VALUES (?, ?, ?, ?, ?)").run(accountId, chat.chat_id, chat.username, chat.first_name, now.toISOString());
      return get(accountId)!;
    },
    unlink: (accountId) => database.prepare("DELETE FROM account_telegram WHERE account_id = ?").run(accountId).changes > 0,
    unlinkChat: (chatId) => {
      const row = database.prepare("SELECT account_id FROM account_telegram WHERE chat_id = ?").get(chatId) as { account_id: string } | undefined;
      if (!row) return null;
      database.prepare("DELETE FROM account_telegram WHERE chat_id = ?").run(chatId);
      return row.account_id;
    },
    createCode: (accountId, now) => {
      const code = randomBytes(18).toString("base64url");
      const expires = new Date(now.getTime() + telegramCodeMinutes * 60_000).toISOString();
      database.prepare("DELETE FROM account_telegram_link WHERE account_id = ? OR expires_at < ?").run(accountId, now.toISOString());
      database.prepare("INSERT INTO account_telegram_link (code, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(code, accountId, now.toISOString(), expires);
      return { code, expires_at: expires };
    },
    consumeCode: (code, now) => {
      const row = database.prepare("SELECT account_id, expires_at FROM account_telegram_link WHERE code = ?").get(code) as { account_id: string; expires_at: string } | undefined;
      if (!row) return null;
      database.prepare("DELETE FROM account_telegram_link WHERE code = ?").run(code);
      return row.expires_at < now.toISOString() ? null : row.account_id;
    },
    chatsFor: (accountIds) => {
      const chats = new Map<string, string>();
      if (!accountIds.length) return chats;
      const placeholders = accountIds.map(() => "?").join(", ");
      for (const row of database.prepare(`SELECT account_id, chat_id FROM account_telegram WHERE account_id IN (${placeholders})`).all(...accountIds) as Array<{ account_id: string; chat_id: string }>) chats.set(row.account_id, row.chat_id);
      return chats;
    },
  };
}

/** The webhook's shared secret: derived from the account state secret, so no extra setting is needed and every process agrees. */
export function telegramWebhookSecret(stateSecret: string): string {
  return createHmac("sha256", stateSecret).update("telegram-webhook").digest("hex");
}

export type TelegramBot = {
  token: string;
  /** Resolved from the token on first use ("LankaPriceLensBot"); null while the token is refused. */
  username: () => Promise<string | null>;
};

/** The bot behind the token, its username fetched once and kept. */
export function telegramBot(token: string, request?: FetchLike): TelegramBot {
  let identity: Promise<string | null> | null = null;
  return {
    token,
    username: () => {
      identity ??= telegramIdentity({ token, fetch: request }).then((found) => found?.username ?? null).catch(() => null);
      return identity;
    },
  };
}

export type TelegramDeps = {
  store: TelegramStore;
  accounts: AccountStore;
  bot: TelegramBot | null;
  /** Carries the telegram channel; replies to the chat go through it directly. */
  channels: ChannelRegistry | null;
  /** LPL_ACCOUNT_STATE_SECRET, for the webhook secret. */
  stateSecret: string;
  siteOrigin: string | null;
  now?: (() => Date) | undefined;
  log?: ((line: Record<string, unknown>) => void) | undefined;
};

export type TelegramBindings = { Variables: { account: Account; requestId: string } };

function fail(context: Context<TelegramBindings>, status: 403 | 404 | 503, text: string, code?: AccountErrorCode | "NOT_FOUND" | "TELEGRAM_UNAVAILABLE") {
  return context.json({ ...envelope(context.get("requestId"), null, false, text), ...(code ? { code } : {}) }, status);
}

/** Account routes, mounted at /v1/account/telegram behind requireAccount; a session is enough. */
export function telegramAccountRoutes(deps: TelegramDeps): Hono<TelegramBindings> {
  const app = new Hono<TelegramBindings>();
  const clock = deps.now ?? (() => new Date());
  app.use("*", async (context, next) => {
    if (context.req.method !== "GET" && !sameOrigin(context)) return fail(context, 403, "Cross-origin request rejected");
    return next();
  });
  app.get("/", async (context) => {
    const status: TelegramStatus = { bot: deps.bot ? await deps.bot.username() : null, linked: deps.store.get(context.get("account").id) ?? null };
    return context.json(envelope(context.get("requestId"), status));
  });
  app.post("/link", async (context) => {
    const username = deps.bot ? await deps.bot.username() : null;
    if (!username) return fail(context, 503, "Telegram is not set up on this site", "TELEGRAM_UNAVAILABLE");
    const { code, expires_at } = deps.store.createCode(context.get("account").id, clock());
    const start: TelegramLinkStart = { url: telegramDeepLink(username, code), expires_at };
    return context.json(envelope(context.get("requestId"), start, true, "Open the link and press Start in Telegram"));
  });
  app.delete("/", async (context) => {
    const account = context.get("account");
    const linked = deps.store.get(account.id);
    if (!linked) return fail(context, 404, "No Telegram chat is linked", "NOT_FOUND");
    deps.store.unlink(account.id);
    await reply(deps, linked.chat_id, "PriceLens is disconnected from this chat. Connect again any time from your account page.");
    return context.json(envelope(context.get("requestId"), null, true, "Telegram disconnected"));
  });
  return app;
}

/** A short plain message to a chat, best effort: a failure is logged and never fails the request. */
async function reply(deps: TelegramDeps, chatId: string, text: string): Promise<void> {
  if (!deps.channels?.has("telegram")) return;
  try {
    const delivery = await sendDirect(deps.channels, { kind: "telegram", address: chatId }, message({ title: "PriceLens", summary: text }));
    if (!delivery.ok) deps.log?.({ level: "warn", message: "Telegram reply failed", detail: delivery.error });
  } catch (error) {
    deps.log?.({ level: "warn", message: "Telegram reply failed", detail: error instanceof Error ? error.message : String(error) });
  }
}

const helpText = (siteOrigin: string | null) => `This is the PriceLens bot. To get your daily recipes, supermarket deals, and price alerts here, open your account page on ${siteOrigin ?? "PriceLens"}, go to Notifications, and press Connect Telegram. Send /stop to disconnect.`;

/** The webhook Telegram posts updates to, mounted at /v1/telegram. Always answers 200 once the secret matches, so Telegram never retries a handled update. */
export function telegramWebhookRoutes(deps: TelegramDeps): Hono<{ Variables: { requestId: string } }> {
  const app = new Hono<{ Variables: { requestId: string } }>();
  const clock = deps.now ?? (() => new Date());
  const expected = Buffer.from(telegramWebhookSecret(deps.stateSecret));
  app.post("/webhook", bodyLimit({ maxSize: 64 * 1024 }), async (context) => {
    const given = Buffer.from(context.req.header("x-telegram-bot-api-secret-token") ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return context.json(envelope(context.get("requestId"), null, false, "Forbidden"), 403);
    const update = parseTelegramUpdate(await context.req.json().catch(() => null));
    if (!update || update.chatType !== "private") return context.json(envelope(context.get("requestId"), null));
    if (update.startPayload !== null) {
      const accountId = update.startPayload ? deps.store.consumeCode(update.startPayload, clock()) : null;
      const account = accountId ? deps.accounts.findAccountById(accountId) : undefined;
      if (!account) {
        await reply(deps, update.chatId, update.startPayload ? "That link has expired. Open your account page on PriceLens, go to Notifications, and press Connect Telegram again." : helpText(deps.siteOrigin));
      } else {
        deps.store.link(account.id, { chat_id: update.chatId, username: update.from?.username ?? null, first_name: update.from?.firstName ?? null }, clock());
        await reply(deps, update.chatId, `Connected to PriceLens as ${account.display_name}. The daily recipes, supermarket deals, and price alerts you switch on under Notifications now arrive here as well. Send /stop to disconnect.`);
      }
    } else if (/^\/stop(?:@\w+)?$/u.test(update.text)) {
      const accountId = deps.store.unlinkChat(update.chatId);
      await reply(deps, update.chatId, accountId ? "Disconnected. PriceLens will not write here again unless you connect from your account page." : "This chat is not connected to a PriceLens account.");
    } else {
      await reply(deps, update.chatId, helpText(deps.siteOrigin));
    }
    return context.json(envelope(context.get("requestId"), null));
  });
  return app;
}

/** Points the bot at this site's webhook when the site is served over https; logs and skips otherwise (a local server cannot be reached by Telegram). */
export async function installTelegramWebhook(deps: { bot: TelegramBot | null; siteOrigin: string | null; stateSecret: string; log: (line: Record<string, unknown>) => void; fetch?: FetchLike | undefined }): Promise<void> {
  if (!deps.bot) return;
  const origin = deps.siteOrigin?.trim().replace(/\/+$/u, "");
  if (!origin?.startsWith("https://")) {
    deps.log({ level: "info", message: "Telegram webhook not installed: the site origin is not https", origin: origin ?? null });
    return;
  }
  try {
    const result = await setTelegramWebhook({ token: deps.bot.token, fetch: deps.fetch }, `${origin}${telegramWebhookPath}`, telegramWebhookSecret(deps.stateSecret));
    deps.log({ level: result.ok ? "info" : "warn", message: result.ok ? "Telegram webhook installed" : "Telegram webhook refused", detail: result.description });
  } catch (error) {
    deps.log({ level: "warn", message: "Telegram webhook failed", detail: error instanceof Error ? error.message : String(error) });
  }
}
