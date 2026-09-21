import assert from "node:assert/strict";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";

import { dueJobs, jobIsDue } from "../src/social/jobs.ts";
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

test("a channel's jobs are seeded on the clock it was already keeping, and Instagram starts off", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createSettingsStore(database, { enabled: true, sendAt: "08:15" });
    const jobs = store.jobs();
    assert.deepEqual(jobs.map((job) => `${job.channel}/${job.job}`), [
      "email/deals_daily", "email/recipes_daily", "email/price_alerts", "telegram/deals_digest", "facebook/deals_post", "instagram/deals_post",
    ]);
    // Nothing changes about when anything goes out the day this ships.
    assert.equal(jobs[0]!.cron, "15 8 * * *");
    assert.equal(jobs[0]!.recurrence, "Every day at 08:15");
    assert.equal(jobs[0]!.enabled, true);
    // Nothing has ever posted to Instagram; a deploy is no moment to start.
    assert.equal(jobs.find((job) => job.channel === "instagram")!.enabled, false);

    const saved = store.saveJob("facebook", "deals_post", { cron: "0 9 * * 1,4" }, "owner@example.com", new Date("2026-09-22T00:00:00.000Z"));
    assert.equal(saved?.recurrence, "Every Monday and Thursday at 09:00");
    assert.equal(store.saveJob("facebook", "deals_post", { cron: "not a cron" }, null, new Date())?.cron, "0 9 * * 1,4", "an expression that cannot be read is refused");
    assert.equal(store.saveJob("facebook", "nothing_like_it", { enabled: false }, null, new Date()), undefined);
  } finally {
    database.close();
  }
});

test("a job runs only when both its own switch and its channel's are on", () => {
  const database = openOperationalDatabase(":memory:");
  try {
    const store = createSettingsStore(database, { enabled: true, sendAt: "07:30" });
    // 02:00Z is 07:30 in Colombo, the minute every seeded job is set to.
    const at = new Date("2026-09-22T02:00:00.000Z");
    const due = dueJobs(store, at).map((job) => `${job.channel}/${job.job}`);
    assert.deepEqual(due, ["email/deals_daily", "email/recipes_daily", "email/price_alerts", "telegram/deals_digest", "facebook/deals_post"], "every seeded job but Instagram's");

    store.save("email", { enabled: false }, null, at);
    assert.equal(dueJobs(store, at).some((job) => job.channel === "email"), false, "the channel's switch stops all of its jobs");

    store.save("email", { enabled: true }, null, at);
    store.saveJob("email", "recipes_daily", { enabled: false }, null, at);
    const left = dueJobs(store, at).map((job) => job.job);
    assert.ok(left.includes("deals_daily") && !left.includes("recipes_daily"), "and one job's switch stops only itself");
    assert.equal(jobIsDue(store.job("email", "deals_daily")!, new Date("2026-09-22T02:01:00.000Z")), false, "a minute later it is not due");
  } finally {
    database.close();
  }
});

test("the channels and the zone are named once, where everything else reads them", () => {
  assert.deepEqual([...settingChannels], ["email", "facebook", "instagram", "telegram"]);
  assert.equal(postingZone, "Asia/Colombo");
  for (const channel of settingChannels) assert.equal(isSettingChannel(channel), true);
  assert.equal(isSettingChannel("whatsapp"), false);
});
