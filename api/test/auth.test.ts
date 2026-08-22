import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import {
  authenticateAdmin,
  createAdminSession,
  findAdminSession,
  revokeAdminSession,
  seedAdminUser,
  verifyPassword,
} from "../src/auth.ts";

test("admin passwords and opaque sessions are verified server-side", () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const encoded = `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`;
  assert.equal(verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(verifyPassword("incorrect", encoded), false);

  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "ADMIN@example.com", encoded);
    const authentication = authenticateAdmin(database, "admin@example.com", "correct horse battery staple");
    assert.equal(authentication.status, "authenticated");
    if (authentication.status !== "authenticated") assert.fail("Expected authentication to succeed");
    const user = authentication.user;
    assert.equal(user.email, "admin@example.com");
    const token = createAdminSession(database, user.id);
    assert.equal(token.includes("$"), false);
    assert.deepEqual(findAdminSession(database, token), user);
    revokeAdminSession(database, token);
    assert.equal(findAdminSession(database, token), undefined);
  } finally {
    database.close();
  }
});

test("admin authentication reports remaining attempts and the temporary lock", () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const encoded = `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`;
  const database = openOperationalDatabase(":memory:");
  try {
    seedAdminUser(database, "admin@example.com", encoded);
    for (const attemptsRemaining of [4, 3, 2, 1]) {
      assert.deepEqual(
        authenticateAdmin(database, "admin@example.com", "incorrect"),
        { status: "invalid_credentials", attemptsRemaining },
      );
    }
    const locked = authenticateAdmin(database, "admin@example.com", "incorrect");
    assert.equal(locked.status, "locked");
    if (locked.status !== "locked") assert.fail("Expected authentication to be locked");
    assert.equal(locked.attemptsRemaining, 0);
    assert.equal(locked.retryAfterSeconds, 15 * 60);
    assert.match(locked.lockedUntil, /^\d{4}-\d{2}-\d{2}T/u);
    assert.equal(authenticateAdmin(database, "admin@example.com", "correct horse battery staple").status, "locked");
  } finally {
    database.close();
  }
});
