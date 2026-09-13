import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { adminAccountRoutes, type AdminAccountBindings, type AdminAccountRow } from "../src/account/admin-routes.ts";
import { createContentStore } from "../src/account/content.ts";
import type { Account, AccountStore } from "../src/account/types.ts";
import { accountFixture, ensureAccountTables, insertAccount } from "./helpers/accounts.ts";

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

/**
 * An in-memory stand-in for the account store, enough for the admin routes: listing with search,
 * status, and paging; reading and patching one account; revoking its sessions. Everything else
 * is outside these routes and throws if reached.
 */
function fakeAccountStore(accounts: Account[]) {
  const revoked: Array<{ accountId: string; now: Date }> = [];
  const unused = (): never => {
    throw new Error("not used by the admin account routes");
  };
  const store: AccountStore = {
    createAccount: unused,
    findAccountById: (id) => accounts.find((account) => account.id === id),
    findAccountByEmail: unused,
    updateAccount: (id, patch, now) => {
      const index = accounts.findIndex((account) => account.id === id);
      const current = accounts[index];
      if (!current) throw new Error("unknown account");
      const next: Account = { ...current, ...patch, updated_at: now.toISOString() };
      accounts[index] = next;
      return next;
    },
    recordLoginFailure: unused,
    recordLoginSuccess: unused,
    deleteAccount: unused,
    countAccounts: () => accounts.length,
    listAccounts: (request) => {
      const needle = request.search.toLowerCase();
      const matches = accounts.filter((account) => (!request.status || account.status === request.status) && (!needle || account.email.toLowerCase().includes(needle) || account.display_name.toLowerCase().includes(needle)));
      const pages = Math.max(1, Math.ceil(matches.length / request.pageSize));
      const page = Math.min(request.page, pages);
      return { items: matches.slice((page - 1) * request.pageSize, page * request.pageSize), total: matches.length, page, pageSize: request.pageSize, pages };
    },
    createSession: unused,
    findSession: unused,
    extendSession: unused,
    revokeSession: unused,
    revokeSessions: (accountId, now) => {
      revoked.push({ accountId, now });
      return 2;
    },
    listSessions: unused,
    createToken: unused,
    consumeToken: unused,
    linkIdentity: unused,
    findIdentity: unused,
    listIdentities: unused,
    unlinkIdentity: unused,
  };
  return { store, revoked };
}

function harness() {
  const database = openOperationalDatabase(":memory:");
  ensureAccountTables(database);
  const alice = accountFixture({ id: "account_alice", email: "alice@example.com", display_name: "Alice Perera" });
  const bob = accountFixture({ id: "account_bob", email: "bob@example.com", display_name: "Bob Silva", password_hash: null, email_verified_at: null });
  const carol = accountFixture({ id: "account_carol", email: "carol@example.com", display_name: "Carol", status: "disabled" });
  for (const account of [alice, bob, carol]) insertAccount(database, account);
  const content = createContentStore(database);
  const now = new Date("2026-09-10T00:00:00Z");
  content.createMenu(alice.id, { name: "Poya lunch", occasion: null, people: 4, items: [] }, now);
  content.createMenu(alice.id, { name: "Almsgiving", occasion: null, people: 30, items: [] }, now);
  content.createMenu(bob.id, { name: "Bob's dinner", occasion: null, people: 2, items: [] }, now);
  content.createRecipe(alice.id, { name: "Amma's dhal", category: "pulses_and_eggs", summary: null, base_servings: 4, serving: { role: "with_rice", portion_g: 150, description: null }, yield_g: 650, ingredients: [{ ref: null, label: { en: "dhal", si: null, ta: null }, quantity: 200, unit: "g", household: null, preparation: null, optional: false, scaling: "linear", part: "main" }], steps: { en: [{ text: "Cook.", minutes: null }], si: null, ta: null }, times: { prep_minutes: 5, cook_minutes: 20, passive_minutes: 0 }, equipment: [], tips: null, tags: [], visibility: "private" }, now);
  const { store, revoked } = fakeAccountStore([alice, bob, carol]);
  const app = new Hono<AdminAccountBindings>();
  app.use("*", requestId());
  app.route("/v1/admin/accounts", adminAccountRoutes({ store, content }));
  const call = async <T>(method: string, path: string, body?: unknown) => {
    const response = await app.request(`http://localhost${path}`, { method, ...(body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...((await response.json()) as Envelope<T>) };
  };
  return { database, call, revoked, store };
}

type Listing = { items: AdminAccountRow[]; page: number; pageSize: number; total: number; pages: number };

test("the admin list shows every account without secrets, with what each keeps, searchable and paged", async () => {
  const { database, call } = harness();
  try {
    const all = await call<Listing>("GET", "/v1/admin/accounts");
    assert.equal(all.status, 200);
    assert.deepEqual([all.payload.page, all.payload.pageSize, all.payload.total, all.payload.pages], [1, 10, 3, 1]);
    assert.deepEqual(all.payload.items.map((row) => [row.id, row.menus, row.recipes, row.has_password]), [["account_alice", 2, 1, true], ["account_bob", 1, 0, false], ["account_carol", 0, 0, true]]);
    for (const row of all.payload.items) {
      assert.equal("password_hash" in row, false, "the hash never leaves the server");
      assert.ok(row.email && row.display_name && row.status && row.created_at);
      assert.deepEqual(row.preferences, { notify_email: true, notify_digest: false, notify_alerts: false });
    }
    assert.equal(all.payload.items[1]!.email_verified_at, null);

    const searched = await call<Listing>("GET", "/v1/admin/accounts?search=bob");
    assert.deepEqual(searched.payload.items.map((row) => row.id), ["account_bob"]);
    const disabled = await call<Listing>("GET", "/v1/admin/accounts?status=disabled");
    assert.deepEqual(disabled.payload.items.map((row) => row.id), ["account_carol"]);
    const paged = await call<Listing>("GET", "/v1/admin/accounts?pageSize=2&page=2");
    assert.deepEqual([paged.payload.page, paged.payload.pageSize, paged.payload.pages, paged.payload.items.map((row) => row.id)], [2, 2, 2, ["account_carol"]]);
    assert.equal((await call<Listing>("GET", "/v1/admin/accounts?pageSize=1000")).payload.pageSize, 100, "a page is a hundred at most");
    assert.equal((await call<Listing>("GET", "/v1/admin/accounts?page=abc&pageSize=x")).payload.page, 1);
    const bad = await call<null>("GET", "/v1/admin/accounts?status=banned");
    assert.deepEqual([bad.status, bad.message], [400, "status must be active or disabled"]);
  } finally {
    database.close();
  }
});

test("disabling an account signs it out everywhere; enabling it does not touch sessions", async () => {
  const { database, call, revoked, store } = harness();
  try {
    const disabled = await call<AdminAccountRow & { sessions_revoked: number }>("PATCH", "/v1/admin/accounts/account_alice", { status: "disabled" });
    assert.equal(disabled.status, 200);
    assert.equal(disabled.message, "Account disabled");
    assert.deepEqual([disabled.payload.status, disabled.payload.sessions_revoked, disabled.payload.menus, disabled.payload.recipes], ["disabled", 2, 2, 1]);
    assert.equal("password_hash" in disabled.payload, false);
    assert.deepEqual(revoked.map((entry) => entry.accountId), ["account_alice"]);
    assert.equal(store.findAccountById("account_alice")?.status, "disabled");

    const enabled = await call<AdminAccountRow & { sessions_revoked: number }>("PATCH", "/v1/admin/accounts/account_carol", { status: "active" });
    assert.deepEqual([enabled.status, enabled.message, enabled.payload.status, enabled.payload.sessions_revoked], [200, "Account enabled", "active", 0]);
    assert.equal(revoked.length, 1, "enabling revokes nothing");

    const missing = await call<null>("PATCH", "/v1/admin/accounts/account_nobody", { status: "disabled" });
    assert.deepEqual([missing.status, missing.code], [404, "NOT_FOUND"]);
    assert.equal((await call("PATCH", "/v1/admin/accounts/account_alice", { status: "deleted" })).status, 400);
    assert.equal((await call("PATCH", "/v1/admin/accounts/account_alice", {})).status, 400);
    assert.equal(revoked.length, 1);
  } finally {
    database.close();
  }
});
