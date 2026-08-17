import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";

import { parseBasicAuthorization, verifyPassword } from "../src/auth.ts";

test("admin credentials are parsed and checked against a scrypt hash", () => {
  const salt = "0123456789abcdef0123456789abcdef";
  const encoded = `scrypt$${salt}$${scryptSync("correct horse battery staple", salt, 64).toString("hex")}`;
  assert.equal(verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(verifyPassword("incorrect", encoded), false);
  assert.deepEqual(parseBasicAuthorization(`Basic ${Buffer.from("owner:secret").toString("base64")}`), {
    username: "owner",
    password: "secret",
  });
});
