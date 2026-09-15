import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { favouriteLimit } from "@lanka-pricelens/shared";

import { createFavouriteStore, describeFavourite } from "../src/account/favourites.ts";
import type { AccountMailer, MailResult } from "../src/account/types.ts";
import { createApp } from "../src/app.ts";

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

test("the favourites store keeps one row per dish, newest first, with a limit", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    database.prepare("INSERT INTO account (id, email, email_verified_at, password_hash, display_name, avatar_url, locale, status, failed_login_count, locked_until, preferences_json, created_at, updated_at) VALUES ('account_a', 'a@example.com', NULL, NULL, 'A', NULL, 'en', 'active', 0, NULL, '{}', '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z')").run();
    const store = createFavouriteStore(database);
    const first = store.add("account_a", "dish_parippu", new Date("2026-09-15T06:00:00.000Z"));
    const again = store.add("account_a", "dish_parippu", new Date("2026-09-15T07:00:00.000Z"));
    assert.equal(again.created_at, first.created_at, "hearting twice keeps the row");
    store.add("account_a", "dish_pol_sambol", new Date("2026-09-15T08:00:00.000Z"));
    assert.deepEqual(store.list("account_a").map((item) => item.dish_id), ["dish_pol_sambol", "dish_parippu"]);
    assert.equal(store.has("account_a", "dish_parippu"), true);
    assert.equal(store.count("account_a"), 2);
    assert.deepEqual([...store.countFor(["account_a", "account_none"]).entries()], [["account_a", 2], ["account_none", 0]]);
    for (let index = 2; index < favouriteLimit; index += 1) store.add("account_a", `dish_extra_${index}`, new Date());
    assert.throws(() => store.add("account_a", "dish_one_too_many", new Date()), /up to/u);
    assert.equal(store.remove("account_a", "dish_parippu"), true);
    assert.equal(store.remove("account_a", "dish_parippu"), false);
    assert.equal(describeFavourite({ dish_id: "dish_parippu", created_at: "2026-09-15T06:00:00.000Z" }, undefined).dish, null, "no catalogue, no description");
  } finally {
    database.close();
  }
});

test("the favourites routes add, list, and remove behind a session, with the origin check", async () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const app = createApp(database, undefined, undefined, { accounts: { mailer: quietMailer() } });
    const registered = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email: "nimal@example.com", password: "a long enough password", display_name: "Nimal" }) });
    await expectStatus(registered, 201);
    const cookie = sessionCookie(registered);

    await expectStatus(await app.request("/v1/account/favourites"), 401);
    const empty = (await (await app.request("/v1/account/favourites", { headers: { cookie } })).json()) as Envelope<{ items: unknown[]; total: number; limit: number }>;
    assert.deepEqual({ total: empty.payload.total, limit: empty.payload.limit }, { total: 0, limit: favouriteLimit });

    const added = await app.request("/v1/account/favourites/dish_parippu", { method: "PUT", headers: { ...json, cookie } });
    await expectStatus(added, 200);
    const body = (await added.json()) as Envelope<{ dish_id: string; dish: unknown }>;
    assert.equal(body.payload.dish_id, "dish_parippu");
    assert.equal(body.payload.dish, null, "no catalogue in this app, so no description");
    await expectStatus(await app.request("/v1/account/favourites/dish_parippu", { method: "PUT", headers: { ...json, cookie } }), 200);
    await expectStatus(await app.request("/v1/account/favourites/not-a-dish", { method: "PUT", headers: { ...json, cookie } }), 404);
    await expectStatus(await app.request("/v1/account/favourites/dish_pol_sambol", { method: "PUT", headers: { "content-type": "application/json", origin: "https://evil.example", host: "localhost", cookie } }), 403);

    const listed = (await (await app.request("/v1/account/favourites", { headers: { cookie } })).json()) as Envelope<{ items: Array<{ dish_id: string }>; total: number }>;
    assert.equal(listed.payload.total, 1);
    assert.equal(listed.payload.items[0]?.dish_id, "dish_parippu");

    await expectStatus(await app.request("/v1/account/favourites/dish_parippu", { method: "DELETE", headers: { ...json, cookie } }), 200);
    await expectStatus(await app.request("/v1/account/favourites/dish_parippu", { method: "DELETE", headers: { ...json, cookie } }), 404);
  } finally {
    database.close();
  }
});
