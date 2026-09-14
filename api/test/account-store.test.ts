import assert from "node:assert/strict";
import { preferencesSchema } from "@lanka-pricelens/shared";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { createAccountStore, hashToken } from "../src/account/store.ts";

const at = (iso: string) => new Date(iso);

test("tokens are single use, of one kind, short-lived, and voided by a newer one", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createAccountStore(database);
    const now = at("2026-09-13T10:00:00.000Z");
    const account = store.createAccount({ email: "nimal@example.com", passwordHash: null, displayName: "Nimal", emailVerified: false }, now);
    assert.match(account.id, /^account_[0-9a-f-]{36}$/u);

    const first = store.createToken(account.id, "verify_email", null, 3600, now);
    const second = store.createToken(account.id, "verify_email", null, 3600, now);
    assert.equal(store.consumeToken(first, "verify_email", now), undefined, "the earlier token of the kind is gone");
    const reset = store.createToken(account.id, "reset_password", null, 3600, now);
    assert.equal(store.consumeToken(second, "reset_password", now), undefined, "a token only works for its own kind");
    assert.equal(store.consumeToken(second, "verify_email", at("2026-09-13T11:00:00.000Z")), undefined, "not once it has expired");
    const consumed = store.consumeToken(second, "verify_email", at("2026-09-13T10:30:00.000Z"));
    assert.equal(consumed?.account_id, account.id);
    assert.equal(consumed?.used_at, "2026-09-13T10:30:00.000Z");
    assert.equal(store.consumeToken(second, "verify_email", at("2026-09-13T10:31:00.000Z")), undefined, "and only once");

    const change = store.createToken(account.id, "change_email", "new@example.com", 3600, now);
    assert.equal(store.consumeToken(change, "change_email", now)?.payload, "new@example.com");
    assert.equal(store.consumeToken(reset, "reset_password", now)?.kind, "reset_password", "another kind is untouched by the change_email token");
    assert.equal(store.consumeToken("", "reset_password", now), undefined);
    assert.equal(store.consumeToken("x".repeat(200), "reset_password", now), undefined);

    const stored = database.prepare("SELECT token_hash FROM account_token").all() as Array<{ token_hash: string }>;
    assert.ok(stored.every((row) => /^[a-f0-9]{64}$/u.test(row.token_hash)), "only hashes are stored");
    assert.equal(stored.some((row) => row.token_hash === hashToken(second)), true);
  } finally {
    database.close();
  }
});

test("sessions are stored hashed and revoked one by one or all but the current", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createAccountStore(database);
    const now = at("2026-09-13T10:00:00.000Z");
    const account = store.createAccount({ email: "nimal@example.com", passwordHash: "scrypt$x$y", displayName: "Nimal", emailVerified: true }, now);
    const laptop = store.createSession(account.id, { userAgent: "Laptop", address: "203.0.113.7" }, 3600, now);
    const phone = store.createSession(account.id, { userAgent: "Phone", address: null }, 3600, now);
    const tablet = store.createSession(account.id, { userAgent: "Tablet", address: null }, 60, now);
    assert.equal(laptop.includes("$"), false);
    assert.equal(store.findSession(laptop, now)?.account.email, "nimal@example.com");
    assert.equal(store.findSession(laptop, now)?.session.user_agent, "Laptop");
    assert.equal(store.findSession(tablet, at("2026-09-13T10:02:00.000Z")), undefined, "expired");
    assert.equal(store.listSessions(account.id, at("2026-09-13T10:02:00.000Z")).length, 2);
    assert.equal(store.findSession(hashToken(laptop), now), undefined, "the stored hash is not a token");

    store.extendSession(hashToken(laptop), at("2026-09-14T10:00:00.000Z"));
    assert.equal(store.findSession(laptop, at("2026-09-13T12:00:00.000Z"))?.session.expires_at, "2026-09-14T10:00:00.000Z");

    assert.equal(store.revokeSessions(account.id, now, hashToken(laptop)), 2, "phone and tablet");
    assert.equal(store.findSession(phone, now), undefined);
    assert.equal(store.findSession(laptop, now)?.session.token_hash, hashToken(laptop));
    store.revokeSession(laptop, now);
    assert.equal(store.findSession(laptop, now), undefined);
    assert.equal(store.revokeSessions(account.id, now), 0);

    // Dead sessions are swept away when a new one starts.
    store.createSession(account.id, { userAgent: null, address: null }, 3600, at("2026-09-13T10:05:00.000Z"));
    assert.equal((database.prepare("SELECT COUNT(*) AS count FROM account_session").get() as { count: number }).count, 1);
  } finally {
    database.close();
  }
});

test("five failed sign-ins lock the account for fifteen minutes", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createAccountStore(database);
    const now = at("2026-09-13T10:00:00.000Z");
    const account = store.createAccount({ email: "nimal@example.com", passwordHash: "scrypt$x$y", displayName: "Nimal", emailVerified: true }, now);
    for (const attemptsRemaining of [4, 3, 2, 1]) assert.deepEqual(store.recordLoginFailure(account.id, now), { locked: false, locked_until: null, attempts_remaining: attemptsRemaining });
    assert.deepEqual(store.recordLoginFailure(account.id, now), { locked: true, locked_until: "2026-09-13T10:15:00.000Z", attempts_remaining: 0 });
    assert.equal(store.findAccountById(account.id)?.locked_until, "2026-09-13T10:15:00.000Z");
    assert.equal(store.findAccountById(account.id)?.failed_login_count, 0, "the count restarts with the lock");
    store.recordLoginFailure(account.id, now);
    store.recordLoginSuccess(account.id, at("2026-09-13T10:20:00.000Z"));
    const cleared = store.findAccountById(account.id)!;
    assert.deepEqual({ count: cleared.failed_login_count, until: cleared.locked_until, updated: cleared.updated_at }, { count: 0, until: null, updated: "2026-09-13T10:20:00.000Z" });
  } finally {
    database.close();
  }
});

test("accounts are found by address regardless of case, updated in part, and listed with search and paging", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createAccountStore(database);
    const base = at("2026-09-13T10:00:00.000Z");
    const people = [
      ["nimal@example.com", "Nimal Perera"],
      ["kamal@example.com", "Kamal Silva"],
      ["amali@example.org", "Amali Fernando"],
      ["sunil@example.com", "Sunil"],
      ["a_b@example.com", "Underscore"],
    ] as const;
    people.forEach(([email, name], index) => store.createAccount({ email, passwordHash: null, displayName: name, locale: "ta", emailVerified: true }, new Date(base.getTime() + index * 1_000)));
    assert.equal(store.countAccounts(), 5);
    assert.equal(store.findAccountByEmail("NIMAL@EXAMPLE.COM")?.display_name, "Nimal Perera");
    assert.equal(store.findAccountByEmail("nobody@example.com"), undefined);
    assert.throws(() => store.createAccount({ email: "Nimal@example.com", passwordHash: null, displayName: "Twin", emailVerified: false }, base), /UNIQUE/u, "the address is unique regardless of case");

    const nimal = store.findAccountByEmail("nimal@example.com")!;
    assert.deepEqual({ locale: nimal.locale, verified: nimal.email_verified_at, preferences: nimal.preferences }, { locale: "ta", verified: "2026-09-13T10:00:00.000Z", preferences: preferencesSchema.parse({}) });
    const updated = store.updateAccount(nimal.id, { display_name: "Nimal P.", preferences: preferencesSchema.parse({ notify_email: false, notify_digest: true }), avatar_url: "https://img.example/n.png" }, at("2026-09-13T11:00:00.000Z"));
    assert.deepEqual({ name: updated.display_name, avatar: updated.avatar_url, locale: updated.locale, updated: updated.updated_at, preferences: updated.preferences }, { name: "Nimal P.", avatar: "https://img.example/n.png", locale: "ta", updated: "2026-09-13T11:00:00.000Z", preferences: preferencesSchema.parse({ notify_email: false, notify_digest: true }) });
    assert.equal(store.updateAccount(nimal.id, { avatar_url: null, status: "disabled" }, base).avatar_url, null, "null clears a nullable column");
    assert.throws(() => store.updateAccount("account_missing", { display_name: "x" }, base), /Account not found/u);
    database.prepare("UPDATE account SET preferences_json = 'not json' WHERE id = ?").run(nimal.id);
    assert.deepEqual(store.findAccountById(nimal.id)?.preferences, preferencesSchema.parse({}), "unreadable preferences fall back to the defaults");

    const all = store.listAccounts({ search: "", status: "", page: 1, pageSize: 2 });
    assert.deepEqual({ total: all.total, pages: all.pages, page: all.page, pageSize: all.pageSize, emails: all.items.map((item) => item.email) }, { total: 5, pages: 3, page: 1, pageSize: 2, emails: ["a_b@example.com", "sunil@example.com"] });
    assert.deepEqual(store.listAccounts({ search: "", status: "", page: 3, pageSize: 2 }).items.map((item) => item.email), ["nimal@example.com"]);
    assert.deepEqual(store.listAccounts({ search: "example.org", status: "", page: 1, pageSize: 25 }).items.map((item) => item.email), ["amali@example.org"]);
    assert.deepEqual(store.listAccounts({ search: "silva", status: "", page: 1, pageSize: 25 }).items.map((item) => item.display_name), ["Kamal Silva"], "the display name is searched too, without regard to case");
    assert.deepEqual(store.listAccounts({ search: "a_b", status: "", page: 1, pageSize: 25 }).items.map((item) => item.email), ["a_b@example.com"], "LIKE wildcards in the search are literal");
    assert.deepEqual(store.listAccounts({ search: "", status: "disabled", page: 1, pageSize: 25 }).items.map((item) => item.email), ["nimal@example.com"]);
    assert.equal(store.listAccounts({ search: "", status: "active", page: 1, pageSize: 25 }).total, 4);
    assert.deepEqual(store.listAccounts({ search: "zzz", status: "", page: 9, pageSize: 500 }), { items: [], total: 0, page: 9, pageSize: 100, pages: 1 });

    store.deleteAccount(nimal.id);
    assert.equal(store.findAccountById(nimal.id), undefined);
    assert.equal(store.countAccounts(), 4);
  } finally {
    database.close();
  }
});

test("identities link a Google subject to an account and go with it", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createAccountStore(database);
    const now = at("2026-09-13T10:00:00.000Z");
    const account = store.createAccount({ email: "nimal@example.com", passwordHash: null, displayName: "Nimal", avatarUrl: "https://img.example/n.png", emailVerified: true }, now);
    assert.equal(account.avatar_url, "https://img.example/n.png");
    const linked = store.linkIdentity({ provider: "google", subject: "sub-1", account_id: account.id, email: "nimal@gmail.example" }, now);
    assert.deepEqual(linked, { provider: "google", subject: "sub-1", account_id: account.id, email: "nimal@gmail.example", created_at: "2026-09-13T10:00:00.000Z" });
    assert.deepEqual(store.findIdentity("google", "sub-1"), linked);
    assert.equal(store.findIdentity("google", "sub-2"), undefined);
    const relinked = store.linkIdentity({ provider: "google", subject: "sub-1", account_id: account.id, email: "renamed@gmail.example" }, at("2026-09-14T10:00:00.000Z"));
    assert.deepEqual({ email: relinked.email, created_at: relinked.created_at }, { email: "renamed@gmail.example", created_at: "2026-09-13T10:00:00.000Z" }, "linking again updates the address and keeps the date");
    assert.equal(store.listIdentities(account.id).length, 1);
    store.unlinkIdentity(account.id, "google");
    assert.deepEqual(store.listIdentities(account.id), []);
    store.linkIdentity({ provider: "google", subject: "sub-1", account_id: account.id, email: "nimal@gmail.example" }, now);
    store.createSession(account.id, { userAgent: null, address: null }, 60, now);
    store.createToken(account.id, "verify_email", null, 60, now);
    store.deleteAccount(account.id);
    for (const table of ["account_identity", "account_session", "account_token"]) {
      assert.equal((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count, 0, `${table} is emptied with the account`);
    }
  } finally {
    database.close();
  }
});
