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
    const user = authenticateAdmin(database, "admin@example.com", "correct horse battery staple");
    assert.equal(user?.email, "admin@example.com");
    const token = createAdminSession(database, user!.id);
    assert.equal(token.includes("$"), false);
    assert.deepEqual(findAdminSession(database, token), user);
    revokeAdminSession(database, token);
    assert.equal(findAdminSession(database, token), undefined);
  } finally {
    database.close();
  }
});
