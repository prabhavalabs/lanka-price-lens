import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { sourceManifestSchema } from "@lanka-pricelens/shared";

import type { AccountMailer, MailResult } from "../src/account/types.ts";
import { createApp } from "../src/app.ts";
import { seedAdminUser } from "../src/auth.ts";
import { readRecipeStore } from "../src/recipes.ts";

const manifest = sourceManifestSchema.parse({
  id: "test_source",
  name: "Test source",
  owner: "Test owner",
  landing_url: "https://example.com/prices",
  retrieval_method: "scheduled_download",
  expected_cadence: "business_daily",
  formats: ["pdf"],
  geographic_scope: "test",
  price_types: ["wholesale_observed"],
  rights_status: "unknown",
  rights_evidence_ref: null,
  attribution_text: null,
  retention_policy: "metadata_and_checksum_only",
  parser_owner: null,
  reviewed_by: null,
  reviewed_at: "2026-08-17",
  review_due_at: "2026-11-17",
  request_interval_ms: 1000,
  max_attempts: 1,
  retry: { attempts: 1, cooldown_minutes: 0 },
  enabled: false,
});
const recipes = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
const origin = "https://price.example.test";
const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

/** A mailer that keeps every message so the test can follow the links the way a person would. */
function recordingMailer() {
  const sent: { kind: string; to: string; link: string | null }[] = [];
  const record = (kind: string) => async (input: { to: string; link?: string }): Promise<MailResult> => {
    sent.push({ kind, to: input.to, link: input.link ?? null });
    return { ok: true, reference: `${kind}-${sent.length}` };
  };
  const mailer: AccountMailer = {
    configured: true,
    describe: () => "recording",
    verifyEmail: record("verify_email"),
    welcome: record("welcome"),
    resetPassword: record("reset_password"),
    passwordChanged: record("password_changed"),
    changeEmail: record("change_email"),
    emailChanged: record("email_changed"),
    accountDeleted: record("account_deleted"),
  };
  return { mailer, sent };
}

const sessionCookie = (response: Response): string => {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /lpl_session=([^;]+)/u.exec(header);
  assert.ok(match, `expected a session cookie, got ${header}`);
  return `lpl_session=${match[1]}`;
};

const tokenOf = (link: string | null): string => {
  assert.ok(link);
  return new URL(link).searchParams.get("token") ?? "";
};

test("the app mounts the account system end to end: register, verify, menus, own recipes, admin listing", async () => {
  const database = openOperationalDatabase(":memory:");
  const { mailer, sent } = recordingMailer();
  try {
    const salt = "0123456789abcdef0123456789abcdef";
    seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`);
    const app = createApp(database, manifest, undefined, { recipes, accounts: { mailer, config: { siteOrigin: origin } } });

    // Anonymous visitors are told to sign in on account content, and get nothing from /me.
    assert.equal((await app.request("/v1/account/me")).status, 401);
    assert.equal((await app.request("/v1/account/menus")).status, 401);

    const registered = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email: "nimal@example.com", password: "a long enough password", display_name: "Nimal" }) });
    assert.equal(registered.status, 201, await registered.text());
    const cookie = sessionCookie(registered);
    const me = (await (await app.request("/v1/account/me", { headers: { cookie } })).json()) as Envelope<{ email: string; email_verified: boolean }>;
    assert.equal(me.payload.email, "nimal@example.com");
    assert.equal(me.payload.email_verified, false);

    // The verification link points at the configured site origin, and consuming it brings the welcome mail.
    const verifyMail = sent.find((mail) => mail.kind === "verify_email");
    assert.ok(verifyMail, "no verify mail");
    assert.ok(verifyMail.link?.startsWith(`${origin}/account/verify?token=`), verifyMail.link ?? "no link");
    const verified = await app.request("/v1/account/verify-email", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ token: tokenOf(verifyMail.link) }) });
    assert.equal(verified.status, 200, await verified.text());
    assert.deepEqual(sent.map((mail) => mail.kind), ["verify_email", "welcome"]);

    // Menus live on the account: create, list, read back.
    const dish = [...recipes.recipes.values()][0];
    assert.ok(dish);
    const created = await app.request("/v1/account/menus", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ name: "Sunday lunch", occasion: null, people: 6, items: [{ recipe_id: dish.id, servings: 6 }] }) });
    assert.equal(created.status, 201, await created.text());
    const menus = (await (await app.request("/v1/account/menus", { headers: { cookie } })).json()) as Envelope<{ items: { name: string; people: number }[] }>;
    assert.deepEqual(menus.payload.items.map((menu) => [menu.name, menu.people]), [["Sunday lunch", 6]]);

    // The ingredient registry serves the recipe editor, ranked by name, without a session.
    const ingredients = (await (await app.request("/v1/public/ingredients?q=coconut")).json()) as Envelope<{ items: { id: string; names: { en: string }; priced: boolean; unit_hint: string }[]; total: number }>;
    assert.ok(ingredients.payload.items.length > 0);
    assert.ok(ingredients.payload.items.every((item) => /coconut/iu.test(item.names.en) || item.id.includes("coconut")));
    assert.ok(ingredients.payload.total >= ingredients.payload.items.length);

    // The owner sees the account in the admin listing behind the owner session.
    assert.equal((await app.request("/v1/admin/accounts")).status, 401);
    const ownerLogin = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple" }) });
    assert.equal(ownerLogin.status, 200, await ownerLogin.text());
    const adminCookie = (ownerLogin.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const listing = await app.request("/v1/admin/accounts", { headers: { cookie: adminCookie } });
    assert.equal(listing.status, 200);
    const accounts = (await listing.json()) as Envelope<{ items: { email: string; menus: number }[] }>;
    assert.deepEqual(accounts.payload.items.map((account) => [account.email, account.menus]), [["nimal@example.com", 1]]);

    // Google sign-in is off without a client: the visitor lands back on the sign-in page with a reason.
    const google = await app.request("/v1/auth/google/start", { headers: { host: "localhost" } });
    assert.equal(google.status, 302);
    assert.match(google.headers.get("location") ?? "", /\/account\/login\?/u);
  } finally {
    database.close();
  }
});

test("sign-in throttling counts failures only, so a household's successful sign-ins never lock it out", async () => {
  const database = openOperationalDatabase(":memory:");
  const { mailer } = recordingMailer();
  try {
    const app = createApp(database, manifest, undefined, { accounts: { mailer } });
    const registered = await app.request("/v1/account/register", { method: "POST", headers: json, body: JSON.stringify({ email: "kamala@example.com", password: "a long enough password", display_name: "Kamala" }) });
    assert.equal(registered.status, 201, await registered.text());
    const login = (password: string) => app.request("/v1/account/login", { method: "POST", headers: json, body: JSON.stringify({ email: "kamala@example.com", password, remember: true }) });
    for (let attempt = 0; attempt < 8; attempt += 1) assert.equal((await login("a long enough password")).status, 200, `success ${attempt}`);
    // Four wrong passwords are refused one by one; the fifth trips the account lock and uses up the address budget.
    for (let attempt = 0; attempt < 4; attempt += 1) assert.equal((await login("not the password")).status, 401, `failure ${attempt}`);
    assert.equal((await login("not the password")).status, 423);
    const throttled = await login("a long enough password");
    assert.equal(throttled.status, 429);
    assert.equal(((await throttled.json()) as Envelope<null>).code, "RATE_LIMITED");
  } finally {
    database.close();
  }
});
