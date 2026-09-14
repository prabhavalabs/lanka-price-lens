import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { watchLimit, type WatchItem } from "@lanka-pricelens/shared";

import type { AccountMailer, MailResult } from "../src/account/types.ts";
import { createWatchStore, type WatchQuote } from "../src/account/watchlist.ts";
import { createApp } from "../src/app.ts";
import { alertDropPct, composeAlertsMail, evaluateWatch } from "../src/newsletters/alerts.ts";

const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

function quietMailer(): AccountMailer {
  const ok = async (): Promise<MailResult> => ({ ok: true, reference: "quiet" });
  return { configured: true, describe: () => "quiet", verifyEmail: ok, welcome: ok, resetPassword: ok, passwordChanged: ok, changeEmail: ok, emailChanged: ok, accountDeleted: ok };
}

const sessionCookie = (response: Response): string => {
  const match = /lpl_session=([^;]+)/u.exec(response.headers.get("set-cookie") ?? "");
  assert.ok(match, "expected a session cookie");
  return `lpl_session=${match[1]}`;
};

const expectStatus = async (response: Response, status: number): Promise<void> => {
  if (response.status !== status) assert.fail(`expected ${status}, got ${response.status}: ${await response.text()}`);
};

test("the wishlist store keeps one row per product with its rule, a limit, and the last alert", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    database.prepare("INSERT INTO account (id, email, email_verified_at, password_hash, display_name, avatar_url, locale, status, failed_login_count, locked_until, preferences_json, created_at, updated_at) VALUES ('account_a', 'a@example.com', NULL, NULL, 'A', NULL, 'en', 'active', 0, NULL, '{}', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')").run();
    const store = createWatchStore(database);
    const now = new Date("2026-09-14T06:00:00.000Z");
    const added = store.put("account_a", "product_big_onion", { mode: "any_drop", threshold_minor: null }, now);
    assert.equal(added.alert.mode, "any_drop");
    assert.equal(added.last_alert_at, null);
    const ruled = store.put("account_a", "product_big_onion", { mode: "below", threshold_minor: 30_000 }, new Date("2026-09-14T07:00:00.000Z"));
    assert.deepEqual(ruled.alert, { mode: "below", threshold_minor: 30_000 });
    assert.equal(ruled.created_at, added.created_at, "re-ruling keeps the row");
    assert.equal(store.count("account_a"), 1);
    store.markAlerted("account_a", "product_big_onion", new Date("2026-09-15T02:00:00.000Z"), 28_000);
    assert.equal(store.get("account_a", "product_big_onion")?.last_alert_minor, 28_000);
    assert.deepEqual(store.productIds(), ["product_big_onion"]);
    assert.deepEqual([...store.countWatched(["account_a", "account_none"]).entries()], [["account_a", 1], ["account_none", 0]]);
    for (let index = 1; index < watchLimit; index += 1) store.put("account_a", `product_extra_${index}`, { mode: "off", threshold_minor: null }, now);
    assert.throws(() => store.put("account_a", "product_one_too_many", { mode: "off", threshold_minor: null }, now), /up to/u);
    assert.equal(store.remove("account_a", "product_big_onion"), true);
    assert.equal(store.remove("account_a", "product_big_onion"), false);
  } finally {
    database.close();
  }
});

const item = (alert: WatchItem["alert"], last: Partial<Pick<WatchItem, "last_alert_at" | "last_alert_minor">> = {}): WatchItem => ({
  product_id: "product_big_onion",
  alert,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  last_alert_at: last.last_alert_at ?? null,
  last_alert_minor: last.last_alert_minor ?? null,
});

const quote = (now: number | null, yesterday: number | null): WatchQuote => ({
  product_id: "product_big_onion",
  label: "Big Onion",
  category: "vegetables",
  unit: "kg",
  cheapest: now === null ? null : { market_id: "market_keells_online", market_label: "Keells Online", group: "supermarket", price: now / 100, observed_on: "2026-09-14" },
  yesterday: yesterday === null ? null : yesterday / 100,
  change_pct: now !== null && yesterday ? Math.round(((now - yesterday) / yesterday) * 1000) / 10 : null,
  sellers: now === null ? 0 : 3,
  now_minor: now,
  yesterday_minor: yesterday,
});

test("alert rules: any drop fires on a fall against yesterday or the last alert; below fires at the mark and repeats after a week", () => {
  const at = new Date("2026-09-14T02:00:00.000Z");
  assert.equal(evaluateWatch(item({ mode: "off", threshold_minor: null }), quote(30_000, 40_000), at), null, "off never fires");
  assert.equal(evaluateWatch(item({ mode: "any_drop", threshold_minor: null }), quote(null, 40_000), at), null, "no price today, nothing to say");
  assert.equal(evaluateWatch(item({ mode: "any_drop", threshold_minor: null }), quote(39_000, 40_000), at), null, `a fall under ${alertDropPct} % is noise`);
  const drop = evaluateWatch(item({ mode: "any_drop", threshold_minor: null }), quote(36_000, 40_000), at);
  assert.equal(drop?.reason, "drop");
  assert.equal(drop?.was_minor, 40_000);
  assert.equal(drop?.pct, -10);
  const sinceLast = evaluateWatch(item({ mode: "any_drop", threshold_minor: null }, { last_alert_at: "2026-09-10T02:00:00.000Z", last_alert_minor: 40_000 }), quote(37_000, 37_500), at);
  assert.equal(sinceLast?.was_minor, 40_000, "flat against yesterday but well under what the last alert said");
  assert.equal(evaluateWatch(item({ mode: "below", threshold_minor: 35_000 }), quote(36_000, 40_000), at), null, "above the mark");
  const below = evaluateWatch(item({ mode: "below", threshold_minor: 35_000 }), quote(34_000, 40_000), at);
  assert.equal(below?.reason, "below");
  assert.equal(below?.pct, -15);
  assert.equal(evaluateWatch(item({ mode: "below", threshold_minor: 35_000 }, { last_alert_at: "2026-09-12T02:00:00.000Z", last_alert_minor: 34_500 }), quote(34_000, 34_500), at), null, "told two days ago while still under the mark");
  assert.equal(evaluateWatch(item({ mode: "below", threshold_minor: 35_000 }, { last_alert_at: "2026-09-01T02:00:00.000Z", last_alert_minor: 34_500 }), quote(34_000, 34_500), at)?.reason, "below", "a week on it says so again");
  assert.equal(evaluateWatch(item({ mode: "below", threshold_minor: 35_000 }, { last_alert_at: "2026-09-12T02:00:00.000Z", last_alert_minor: 36_000 }), quote(34_000, 36_000), at)?.reason, "below", "the last alert was above the mark, so this crossing is news");

  const mail = composeAlertsMail({ display_name: "Nimal" }, "2026-09-14", [drop!, below!], { siteOrigin: "https://price.example.test/" }, "https://price.example.test/u");
  assert.ok(mail);
  assert.deepEqual(mail.summary, { hits: 2, drops: 1, below: 1 });
  assert.equal(mail.data.values.link, "https://price.example.test/account#wishlist");
  const block = mail.data.blocks?.[0];
  assert.ok(block && block.type === "deals");
  assert.equal(block.rows[0]?.pct, -15, "the larger fall first");
  assert.match(block.rows[0]?.was ?? "", /under your mark of Rs 350/u);
  assert.match(block.rows[1]?.was ?? "", /was Rs 400 .* yesterday/u);
  assert.equal(composeAlertsMail({ display_name: "Nimal" }, "2026-09-14", [], { siteOrigin: "x" }), null);
});

test("the wishlist routes add, list, re-rule, and remove behind a session, with the origin check and the limit", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const app = createApp(database, undefined, undefined, { accounts: { mailer: quietMailer() } });
    const registered = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email: "nimal@example.com", password: "a long enough password", display_name: "Nimal" }) });
    await expectStatus(registered, 201);
    const cookie = sessionCookie(registered);

    await expectStatus(await app.request("/v1/account/watchlist"), 401);
    const empty = (await (await app.request("/v1/account/watchlist", { headers: { cookie } })).json()) as Envelope<{ items: unknown[]; total: number; limit: number; priced: boolean }>;
    assert.deepEqual({ total: empty.payload.total, limit: empty.payload.limit, priced: empty.payload.priced }, { total: 0, limit: watchLimit, priced: false });

    const added = await app.request("/v1/account/watchlist/product_big_onion", { method: "PUT", headers: { ...json, cookie } });
    await expectStatus(added, 201);
    assert.equal(((await added.json()) as Envelope<{ alert: { mode: string } }>).payload.alert.mode, "any_drop", "the default rule");
    const again = await app.request("/v1/account/watchlist/product_big_onion", { method: "PUT", headers: { ...json, cookie }, body: JSON.stringify({ alert: { mode: "below", threshold_minor: 30000 } }) });
    await expectStatus(again, 200);
    const ruled = await app.request("/v1/account/watchlist/product_big_onion", { method: "PATCH", headers: { ...json, cookie }, body: JSON.stringify({ alert: { mode: "below", threshold_minor: 28000 } }) });
    await expectStatus(ruled, 200);
    assert.deepEqual(((await ruled.json()) as Envelope<{ alert: unknown }>).payload.alert, { mode: "below", threshold_minor: 28000 });
    await expectStatus(await app.request("/v1/account/watchlist/product_unknown_thing", { method: "PATCH", headers: { ...json, cookie }, body: JSON.stringify({ alert: { mode: "off" } }) }), 404);
    await expectStatus(await app.request("/v1/account/watchlist/not-a-product", { method: "PUT", headers: { ...json, cookie } }), 400);
    await expectStatus(await app.request("/v1/account/watchlist/product_potato", { method: "PUT", headers: { "content-type": "application/json", origin: "https://evil.example", host: "localhost", cookie } }), 403);

    const listed = (await (await app.request("/v1/account/watchlist", { headers: { cookie } })).json()) as Envelope<{ items: Array<{ product_id: string; price: unknown }>; total: number }>;
    assert.equal(listed.payload.total, 1);
    assert.equal(listed.payload.items[0]?.product_id, "product_big_onion");
    assert.equal(listed.payload.items[0]?.price, null, "no warehouse in this app");

    await expectStatus(await app.request("/v1/account/watchlist/product_big_onion", { method: "DELETE", headers: { ...json, cookie } }), 200);
    await expectStatus(await app.request("/v1/account/watchlist/product_big_onion", { method: "DELETE", headers: { ...json, cookie } }), 404);
  } finally {
    database.close();
  }
});
