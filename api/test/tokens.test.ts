import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { createApp } from "../src/app.ts";
import { adminTokenPrefix, bearerToken, createAdminToken, findAdminToken, listAdminTokens, revokeAdminToken, scopeAllows, seedAdminUser } from "../src/auth.ts";

const json = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
const password = "correct horse battery staple";
const salt = "0123456789abcdef0123456789abcdef";

function bench() {
  const database = openOperationalDatabase(":memory:");
  seedAdminUser(database, "owner@example.com", `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`);
  const userId = (database.prepare("SELECT id FROM admin_user WHERE email = 'owner@example.com'").get() as { id: string }).id;
  return { database, userId };
}

test("a token is shown once, kept only as a hash, and answers only to its own value", () => {
  const { database, userId } = bench();
  try {
    const made = createAdminToken(database, { userId, name: "MCP on the laptop", scope: "distribution" });
    assert.ok(made.token.startsWith(adminTokenPrefix), "a token is recognisable on sight");
    assert.ok(made.token.length > 40);

    const stored = database.prepare("SELECT token_hash FROM admin_token WHERE id = ?").get(made.row.id) as { token_hash: string };
    assert.ok(!stored.token_hash.includes(made.token.slice(adminTokenPrefix.length)), "the database never holds the token itself");
    assert.match(stored.token_hash, /^[0-9a-f]{64}$/u);

    const found = findAdminToken(database, made.token);
    assert.deepEqual([found?.user.email, found?.scope], ["owner@example.com", "distribution"]);
    assert.equal(findAdminToken(database, `${made.token}x`), null);
    assert.equal(findAdminToken(database, "not-one-of-ours"), null);
    assert.equal(findAdminToken(database, undefined), null);

    // Using it is recorded, which is what makes a forgotten token visible later.
    assert.ok(listAdminTokens(database, userId)[0]?.last_used_at);
  } finally {
    database.close();
  }
});

test("a revoked token and an expired one both stop working", () => {
  const { database, userId } = bench();
  try {
    const live = createAdminToken(database, { userId, name: "Live", scope: "full" });
    const stale = createAdminToken(database, { userId, name: "Stale", scope: "full", expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(findAdminToken(database, stale.token), null, "past its day");

    assert.ok(findAdminToken(database, live.token));
    assert.equal(revokeAdminToken(database, userId, live.row.id), true);
    assert.equal(findAdminToken(database, live.token), null, "revoked");
    assert.equal(revokeAdminToken(database, userId, live.row.id), false, "revoking twice changes nothing");
    assert.equal(revokeAdminToken(database, "someone-else", live.row.id), false, "another owner cannot revoke it");
  } finally {
    database.close();
  }
});

test("the distribution scope reaches the channels and nothing else", () => {
  assert.equal(scopeAllows("distribution", "/v1/admin/distribution/library"), true);
  assert.equal(scopeAllows("distribution", "/v1/admin/distribution/calendar"), true);
  assert.equal(scopeAllows("distribution", "/v1/admin/accounts"), false);
  assert.equal(scopeAllows("distribution", "/v1/admin/sources"), false);
  assert.equal(scopeAllows("distribution", "/v1/admin/tokens"), false);
  assert.equal(scopeAllows("full", "/v1/admin/accounts"), true);
  assert.equal(bearerToken("Bearer lpl_abc"), "lpl_abc");
  assert.equal(bearerToken("bearer lpl_abc"), undefined);
  assert.equal(bearerToken(undefined), undefined);
});

test("over HTTP: a token signs in without a cookie, is held to its scope, and cannot mint another", async () => {
  const { database } = bench();
  try {
    const app = createApp(database, undefined, undefined, { accounts: { config: { siteOrigin: "https://price.example.test", stateSecret: "state-secret" } } });
    const login = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "owner@example.com", password }) });
    const cookie = /lpl_admin_session=([^;]+)/u.exec(login.headers.get("set-cookie") ?? "")?.[0] ?? "";
    assert.ok(cookie);

    const made = (await (await app.request("/v1/admin/tokens", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ name: "MCP", scope: "distribution" }) })).json()) as {
      payload: { token: string; row: { scope: string } };
    };
    assert.ok(made.payload.token.startsWith(adminTokenPrefix));
    assert.equal(made.payload.row.scope, "distribution");
    const auth = { authorization: `Bearer ${made.payload.token}`, host: "localhost" };

    // No cookie, no matching Origin: a token stands on its own, which is the point of it.
    assert.equal((await app.request("/v1/admin/distribution", { headers: auth })).status, 200);
    assert.equal((await app.request("/v1/admin/distribution", { headers: { host: "localhost" } })).status, 401);

    // Outside its scope it is refused, and told why rather than left guessing.
    const outside = await app.request("/v1/admin/sources", { headers: auth });
    assert.equal(outside.status, 403);
    assert.match(((await outside.json()) as { message: string }).message, /distribution part of the admin/u);

    // A token cannot make another, so one that leaks cannot make itself permanent.
    assert.equal((await app.request("/v1/admin/tokens", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "Another" }) })).status, 403);
    assert.equal((await app.request("/v1/admin/tokens", { headers: auth })).status, 403);

    // Revoked from the browser, dead everywhere.
    const listed = (await (await app.request("/v1/admin/tokens", { headers: { ...json, cookie } })).json()) as { payload: Array<{ id: string }> };
    assert.equal((await app.request(`/v1/admin/tokens/${listed.payload[0]!.id}`, { method: "DELETE", headers: { ...json, cookie } })).status, 200);
    assert.equal((await app.request("/v1/admin/distribution", { headers: auth })).status, 401);
  } finally {
    database.close();
  }
});

test("a token without a name is refused, and the scope falls back to the narrow one", async () => {
  const { database } = bench();
  try {
    const app = createApp(database, undefined, undefined, { accounts: { config: { siteOrigin: "https://price.example.test", stateSecret: "state-secret" } } });
    const login = await app.request("/v1/auth/login", { method: "POST", headers: json, body: JSON.stringify({ email: "owner@example.com", password }) });
    const cookie = /lpl_admin_session=([^;]+)/u.exec(login.headers.get("set-cookie") ?? "")?.[0] ?? "";
    assert.equal((await app.request("/v1/admin/tokens", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ name: "  " }) })).status, 400);
    const made = (await (await app.request("/v1/admin/tokens", { method: "POST", headers: { ...json, cookie }, body: JSON.stringify({ name: "No scope given" }) })).json()) as { payload: { row: { scope: string; expires_at: string | null } } };
    assert.deepEqual([made.payload.row.scope, made.payload.row.expires_at], ["distribution", null]);
  } finally {
    database.close();
  }
});
