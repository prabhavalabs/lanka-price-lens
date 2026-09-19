import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { createChannels } from "@lanka-pricelens/notify";

import { createAccountStore } from "../src/account/store.ts";
import { createTelegramStore, telegramAccountRoutes, telegramBot, telegramWebhookRoutes, telegramWebhookSecret, type TelegramDeps } from "../src/account/telegram.ts";
import type { AccountMailer, MailResult } from "../src/account/types.ts";
import { createApp } from "../src/app.ts";
import { channelDealsMessage, telegramMessageOf } from "../src/newsletters/telegram.ts";
import { sampleDealsDay } from "../src/newsletters/admin-routes.ts";

const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

function quietMailer(): AccountMailer {
  const ok = async (): Promise<MailResult> => ({ ok: true, reference: "quiet" });
  return { configured: true, describe: () => "quiet", verifyEmail: ok, welcome: ok, resetPassword: ok, passwordChanged: ok, changeEmail: ok, emailChanged: ok, accountDeleted: ok };
}

/** A Telegram API that records what the bot sends and answers getMe with a fixed username. */
function fakeTelegram() {
  const sent: Array<{ method: string; body: Record<string, unknown> }> = [];
  const request = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = url.split("/").pop() ?? "";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    sent.push({ method, body });
    if (method === "getMe") return new Response(JSON.stringify({ ok: true, result: { id: 42, username: "PriceLensTestBot" } }), { status: 200 });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
  }) as typeof fetch;
  return { sent, request };
}

function seedAccount(database: ReturnType<typeof openOperationalDatabase>, id: string, email: string): void {
  database.prepare("INSERT INTO account (id, email, email_verified_at, password_hash, display_name, avatar_url, locale, status, failed_login_count, locked_until, preferences_json, created_at, updated_at) VALUES (?, ?, '2026-09-14T00:00:00.000Z', NULL, 'Nimal', NULL, 'en', 'active', 0, NULL, '{}', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')").run(id, email);
}

test("the telegram store binds one chat to one account, hands out short-lived codes, and lists chats for a run", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAccount(database, "account_a", "a@example.com");
    seedAccount(database, "account_b", "b@example.com");
    const store = createTelegramStore(database);
    const now = new Date("2026-09-15T08:00:00.000Z");
    const { code, expires_at } = store.createCode("account_a", now);
    assert.match(code, /^[\w-]{20,}$/u);
    assert.equal(expires_at, "2026-09-15T08:15:00.000Z");
    assert.equal(store.consumeCode("nope", now), null);
    assert.equal(store.consumeCode(code, new Date("2026-09-15T08:20:00.000Z")), null, "an expired code is refused and gone");
    const fresh = store.createCode("account_a", now).code;
    assert.equal(store.consumeCode(fresh, now), "account_a");
    assert.equal(store.consumeCode(fresh, now), null, "a code works once");
    store.link("account_a", { chat_id: "100", username: "nimal", first_name: "Nimal" }, now);
    assert.equal(store.get("account_a")?.chat_id, "100");
    store.link("account_b", { chat_id: "100", username: "nimal", first_name: "Nimal" }, now);
    assert.equal(store.get("account_a"), undefined, "a chat moves to the account that linked it last");
    assert.equal(store.byChat("100")?.account_id, "account_b");
    assert.deepEqual([...store.chatsFor(["account_a", "account_b"]).entries()], [["account_b", "100"]]);
    assert.equal(store.unlinkChat("100"), "account_b");
    assert.equal(store.unlinkChat("100"), null);
    assert.equal(store.unlink("account_b"), false);
  } finally {
    database.close();
  }
});

test("the account routes hand out a deep link, the webhook binds the chat on /start and frees it on /stop, and the secret gates it", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    seedAccount(database, "account_a", "a@example.com");
    const telegram = fakeTelegram();
    const deps: TelegramDeps = {
      store: createTelegramStore(database),
      accounts: createAccountStore(database),
      bot: telegramBot("123:token", telegram.request),
      channels: createChannels({ telegram: { token: "123:token" }, fetch: telegram.request }),
      stateSecret: "state-secret",
      siteOrigin: "https://price.example",
      now: () => new Date("2026-09-15T08:00:00.000Z"),
    };
    const account = { account: deps.accounts.findAccountById("account_a")!, requestId: "req" };
    const routes = telegramAccountRoutes(deps);
    routes.use("*", async (context, next) => {
      context.set("account", account.account);
      context.set("requestId", account.requestId);
      return next();
    });
    // Middleware added after the routes runs too late; build a fresh app with the account set first.
    const { Hono } = await import("hono");
    const app = new Hono<{ Variables: { account: typeof account.account; requestId: string } }>();
    app.use("*", async (context, next) => {
      context.set("account", account.account);
      context.set("requestId", "req");
      return next();
    });
    app.route("/v1/account/telegram", telegramAccountRoutes(deps));
    app.route("/v1/telegram", telegramWebhookRoutes(deps));

    const status = (await (await app.request("/v1/account/telegram")).json()) as Envelope<{ bot: string | null; linked: unknown }>;
    assert.deepEqual(status.payload, { bot: "PriceLensTestBot", linked: null });

    const started = await app.request("/v1/account/telegram/link", { method: "POST", headers: json });
    assert.equal(started.status, 200);
    const link = ((await started.json()) as Envelope<{ url: string; expires_at: string }>).payload;
    assert.match(link.url, /^https:\/\/t\.me\/PriceLensTestBot\?start=[\w-]+$/u);
    const code = link.url.split("start=")[1]!;

    const secret = telegramWebhookSecret("state-secret");
    const update = (text: string) => ({ message: { chat: { id: 555, type: "private" }, text, from: { id: 555, username: "nimal", first_name: "Nimal" } } });
    assert.equal((await app.request("/v1/telegram/webhook", { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": "wrong" }, body: JSON.stringify(update(`/start ${code}`)) })).status, 403);
    const webhookHeaders = { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret };
    assert.equal((await app.request("/v1/telegram/webhook", { method: "POST", headers: webhookHeaders, body: JSON.stringify(update(`/start ${code}`)) })).status, 200);
    assert.equal(deps.store.get("account_a")?.chat_id, "555");
    const linked = (await (await app.request("/v1/account/telegram")).json()) as Envelope<{ linked: { username: string } | null }>;
    assert.equal(linked.payload.linked?.username, "nimal");
    const welcome = telegram.sent.find((call) => call.method === "sendMessage");
    assert.ok(welcome && String(welcome.body.text).includes("Connected to PriceLens as Nimal"), "the chat is told");
    assert.equal(welcome?.body.chat_id, "555");

    assert.equal((await app.request("/v1/telegram/webhook", { method: "POST", headers: webhookHeaders, body: JSON.stringify(update(`/start ${code}`)) })).status, 200);
    assert.ok(telegram.sent.some((call) => String(call.body.text).includes("expired")), "a used code is refused politely");
    assert.equal((await app.request("/v1/telegram/webhook", { method: "POST", headers: webhookHeaders, body: JSON.stringify(update("hello")) })).status, 200);
    assert.ok(telegram.sent.some((call) => String(call.body.text).includes("Connect Telegram")), "anything else gets the help text");
    assert.equal((await app.request("/v1/telegram/webhook", { method: "POST", headers: webhookHeaders, body: JSON.stringify(update("/stop")) })).status, 200);
    assert.equal(deps.store.get("account_a"), undefined);
    assert.ok(telegram.sent.some((call) => String(call.body.text).includes("Disconnected.")));

    deps.store.link("account_a", { chat_id: "555", username: "nimal", first_name: "Nimal" }, new Date());
    assert.equal((await app.request("/v1/account/telegram", { method: "DELETE", headers: json })).status, 200);
    assert.equal(deps.store.get("account_a"), undefined);
    assert.equal((await app.request("/v1/account/telegram", { method: "DELETE", headers: json })).status, 404);
    assert.equal((await app.request("/v1/account/telegram", { method: "DELETE", headers: { ...json, origin: "https://evil.example" } })).status, 403);
  } finally {
    database.close();
  }
});

test("the daily mails become Telegram messages with the same lines, the recipe photo, and the button; the channel gets the day's digest", () => {
  const data = {
    values: { name: "Nimal", date: "Monday 15 September", count: "three", link: "https://price.example/recipes" },
    blocks: [{ type: "recipes" as const, heading: null, cards: [{ image: "https://price.example/images/recipes/parippu.jpg", name: "Red dhal curry", summary: "Lentils.", kcal: 281, minutes: 35, cost: "Rs 95 per serving", url: "https://price.example/r/dish_parippu" }] }],
    unsubscribeUrl: null,
  };
  const recipes = telegramMessageOf("recipes_daily", data, undefined, "k:telegram");
  assert.equal(recipes.title, "Three recipes for today");
  assert.match(recipes.summary ?? "", /^Hi Nimal, here are three dishes/u);
  assert.equal(recipes.image?.url, "https://price.example/images/recipes/parippu.jpg");
  assert.deepEqual(recipes.sections[0]?.lines[0], { text: "Red dhal curry", value: "Rs 95 per serving", note: "281 kcal · 35 min", url: "https://price.example/r/dish_parippu" });
  assert.deepEqual(recipes.actions, [{ label: "Browse all recipes", url: "https://price.example/recipes" }]);
  assert.equal(recipes.dedupe_key, "k:telegram");

  const deals = telegramMessageOf("deals_daily", { values: { name: "Nimal", date: "Monday", count: 1, stores: "Keells", link: "https://price.example/" }, blocks: [{ type: "deals" as const, heading: "Biggest drops today", rows: [{ product: "Big onion", store: "21% off at Keells", now: "Rs 370 / kg", was: "was Rs 470", pct: -21.3, url: "https://price.example/p/product_big_onion" }], note: null }] }, undefined, "d");
  assert.equal(deals.sections[0]?.heading, "Biggest drops today");
  assert.equal(deals.sections[0]?.lines[0]?.change, -21.3);
  assert.equal(deals.image, undefined);

  const channel = channelDealsMessage(sampleDealsDay("2026-09-15"), "https://price.example/");
  assert.ok(channel);
  assert.equal(channel.title, "Today's supermarket deals · Tuesday 15 September");
  assert.equal(channel.dedupe_key, "channel:deals_daily:2026-09-15");
  assert.equal(channel.sections[0]?.lines[0]?.url, "https://price.example/p/product_big_onion");
  assert.deepEqual(channel.sections.map((section) => section.heading), ["Biggest drops", "Store offers", "Cheapest store today"]);
  assert.deepEqual(channel.sections[1]?.lines[1], { text: "Chicken, whole", value: "Rs 1,120 / kg", change: -20, note: "20% off at Keells with Nexus", url: "https://price.example/p/product_chicken" });
  assert.equal(channelDealsMessage({ ...sampleDealsDay("2026-09-15"), deals: [], cheapest: [], store_offers: [] }, "https://price.example"), null);
  assert.ok(channelDealsMessage({ ...sampleDealsDay("2026-09-15"), deals: [], cheapest: [] }, "https://price.example"), "the stores' own offers alone are worth a post");
});

test("a run queues the mail for the linked chat as well as the address, unless the person switched Telegram off", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const { resolve } = await import("node:path");
    const { readRecipeStore } = await import("../src/recipes.ts");
    const recipes = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
    const app = createApp(database, undefined, undefined, { accounts: { mailer: quietMailer() }, recipes });
    const registered = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email: "nimal@example.com", password: "a long enough password", display_name: "Nimal" }) });
    assert.equal(registered.status, 201);
    const id = ((await registered.json()) as Envelope<{ id: string }>).payload.id;
    database.prepare("UPDATE account SET email_verified_at = '2026-09-15T00:00:00.000Z', preferences_json = '{\"notify_recipes\":true,\"notify_telegram\":true}' WHERE id = ?").run(id);
    createTelegramStore(database).link(id, { chat_id: "777", username: "nimal", first_name: "Nimal" }, new Date());
    const rows = () => database.prepare("SELECT channel, address, dedupe_key FROM notify_outbox ORDER BY created_at, channel").all() as Array<{ channel: string; address: string; dedupe_key: string | null }>;
    const { newsletterServices } = await import("../src/app.ts");
    const service = newsletterServices.get(app)!;
    const first = await service.runNewsletter("recipes_daily", { trigger: "test", day: "2026-09-15" });
    assert.equal(first.run.status, "sent", first.run.error ?? "");
    assert.equal(first.run.report?.telegram, 1);
    assert.deepEqual(rows().map((row) => [row.channel, row.address]), [["email", "nimal@example.com"], ["telegram", "777"]]);
    assert.ok(rows()[1]?.dedupe_key?.endsWith(":telegram"));

    database.prepare("UPDATE account SET preferences_json = '{\"notify_recipes\":true,\"notify_telegram\":false}' WHERE id = ?").run(id);
    const second = await service.runNewsletter("recipes_daily", { trigger: "test", day: "2026-09-16" });
    assert.equal(second.run.status, "sent");
    assert.equal(second.run.report?.telegram ?? 0, 0, "Telegram switched off");
    assert.equal(rows().filter((row) => row.channel === "telegram").length, 1);
  } finally {
    database.close();
  }
});
