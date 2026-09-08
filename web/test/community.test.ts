import assert from "node:assert/strict";
import test from "node:test";

import { inviteAfterMs, inviteCooldownMs, readInviteMemory, shouldInvite, writeInviteMemory } from "../src/lib/community.ts";

const start = 1_000_000;

test("the invite appears a few seconds after arriving, not before", () => {
  assert.equal(shouldInvite({}, { startedAt: start }, start + inviteAfterMs - 1), false);
  assert.equal(shouldInvite({}, { startedAt: start }, start + inviteAfterMs), true);
});

test("not now means a month of quiet, and joining means never again", () => {
  const later = start + inviteAfterMs;
  assert.equal(shouldInvite({ dismissedAt: start }, { startedAt: start }, later), false);
  assert.equal(shouldInvite({ dismissedAt: start }, { startedAt: start }, start + inviteCooldownMs + later), true);
  assert.equal(shouldInvite({ joinedAt: start }, { startedAt: start }, start + inviteCooldownMs * 12), false);
});

test("memory survives a broken or missing store", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  writeInviteMemory(storage, { dismissedAt: 5 });
  assert.deepEqual(readInviteMemory(storage), { dismissedAt: 5 });
  store.set("pricelens.community.v1", "{not json");
  assert.deepEqual(readInviteMemory(storage), {});
  assert.deepEqual(readInviteMemory(undefined), {});
  writeInviteMemory({ setItem: () => { throw new Error("full"); } }, { joinedAt: 1 });
});
