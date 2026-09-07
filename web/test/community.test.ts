import assert from "node:assert/strict";
import test from "node:test";

import { inviteAfterMs, inviteAfterPageViews, inviteCooldownMs, inviteQuietMs, readInviteMemory, shouldInvite, writeInviteMemory } from "../src/lib/community.ts";

const start = 1_000_000;

test("the invite waits for a look around and stays quiet at first", () => {
  assert.equal(shouldInvite({}, { pageViews: 1, startedAt: start }, start + 1000), false, "first moments");
  assert.equal(shouldInvite({}, { pageViews: inviteAfterPageViews, startedAt: start }, start + 1000), false, "even with pages, not in the quiet period");
  assert.equal(shouldInvite({}, { pageViews: inviteAfterPageViews, startedAt: start }, start + inviteQuietMs + 1), true, "a few pages after the quiet period");
  assert.equal(shouldInvite({}, { pageViews: 1, startedAt: start }, start + inviteAfterMs), true, "or a while on the site");
  assert.equal(shouldInvite({}, { pageViews: 1, startedAt: start }, start + inviteAfterMs - 1), false, "not before");
});

test("not now means a month of quiet, and joining means never again", () => {
  const ready = { pageViews: 5, startedAt: start };
  const later = start + inviteAfterMs;
  assert.equal(shouldInvite({ dismissedAt: start }, ready, later), false);
  assert.equal(shouldInvite({ dismissedAt: start }, ready, start + inviteCooldownMs + later), true);
  assert.equal(shouldInvite({ joinedAt: start }, ready, start + inviteCooldownMs * 12), false);
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
