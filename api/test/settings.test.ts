import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { shouldRun } from "../src/newsletters/scheduler.ts";
import { createSettingsStore, defaultSendAt, isClock, isSettingChannel, postingZone, settingChannels } from "../src/social/settings.ts";

const now = new Date("2026-09-22T06:00:00.000Z");

test("the environment seeds the table once, and the admin owns it after that", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    // What the server has been doing until now becomes the starting point, so shipping this changes nothing.
    const store = createSettingsStore(database, { enabled: true, sendAt: "07:30" });
    assert.deepEqual(store.all().map((row) => [row.channel, row.enabled, row.send_at]), settingChannels.map((channel) => [channel, true, "07:30"]));

    store.save("email", { send_at: "08:00" }, "owner@example.com", now);
    const saved = store.of("email");
    assert.deepEqual([saved.send_at, saved.enabled, saved.updated_by], ["08:00", true, "owner@example.com"]);

    // A second build with different environment values does not overwrite what the owner chose.
    const again = createSettingsStore(database, { enabled: false, sendAt: "05:00" });
    assert.equal(again.of("email").send_at, "08:00", "the admin's setting stands");
    assert.equal(again.of("facebook").send_at, "07:30", "and so does every other channel's");
  } finally {
    database.close();
  }
});

test("a channel can be switched off and on without touching the others", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createSettingsStore(database, { enabled: true, sendAt: defaultSendAt });
    store.save("instagram", { enabled: false }, null, now);
    assert.equal(store.of("instagram").enabled, false);
    assert.equal(store.of("facebook").enabled, true, "the Page is untouched");
    assert.equal(store.of("email").enabled, true);
    store.save("instagram", { enabled: true }, null, now);
    assert.equal(store.of("instagram").enabled, true);
  } finally {
    database.close();
  }
});

test("a time that is not a time is refused, and a bad one never reaches the row", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createSettingsStore(database, { enabled: true, sendAt: "07:30" });
    for (const bad of ["7:30", "25:00", "07:60", "half past seven", "", "0730"]) assert.equal(isClock(bad), false, `${bad} is not a clock`);
    for (const good of ["00:00", "07:30", "23:59"]) assert.equal(isClock(good), true);

    // The store keeps what it has rather than writing nonsense.
    store.save("email", { send_at: "nonsense" }, null, now);
    assert.equal(store.of("email").send_at, "07:30");
  } finally {
    database.close();
  }
});

test("a seed the environment got wrong falls back rather than poisoning every channel", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createSettingsStore(database, { enabled: true, sendAt: "not a time" });
    assert.equal(store.of("email").send_at, defaultSendAt);
  } finally {
    database.close();
  }
});

test("the scheduler obeys the hour it is given, which is now the one from the table", () => {
  // Colombo is UTC+5:30, so 02:00Z is 07:30 there: the moment the send time is reached.
  const justBefore = new Date("2026-09-22T01:59:00.000Z");
  const justAfter = new Date("2026-09-22T02:01:00.000Z");
  assert.equal(shouldRun(justBefore, "07:30", null), false);
  assert.equal(shouldRun(justAfter, "07:30", null), true);
  // Moved to eight, the same moment is too early.
  assert.equal(shouldRun(justAfter, "08:00", null), false);
  assert.equal(shouldRun(new Date("2026-09-22T02:31:00.000Z"), "08:00", null), true);
  // A day already sent is not sent again, whatever the hour says.
  assert.equal(shouldRun(justAfter, "07:30", { status: "sent", started_at: justAfter.toISOString() }), false);
});

test("the channels and the zone are named once, where everything else reads them", () => {
  assert.deepEqual([...settingChannels], ["email", "facebook", "instagram", "telegram"]);
  assert.equal(postingZone, "Asia/Colombo");
  for (const channel of settingChannels) assert.equal(isSettingChannel(channel), true);
  assert.equal(isSettingChannel("whatsapp"), false);
});
