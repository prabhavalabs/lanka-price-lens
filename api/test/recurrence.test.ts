import assert from "node:assert/strict";
import test from "node:test";

import { clockParts, cronFromForm, cronMatches, describeCron, isCron, nextRun, parseCron, previousRun } from "../src/social/recurrence.ts";

/** A moment written in Colombo time, which is UTC+5:30 and has been since 2006. */
const colombo = (text: string): Date => new Date(`${text}+05:30`);

test("an expression is read field by field, and what cannot be read is refused", () => {
  assert.ok(isCron("30 7 * * *"));
  assert.ok(isCron("*/15 * * * *"));
  assert.ok(isCron("0 9 * * mon-fri"));
  assert.ok(isCron("0 0 1,15 * *"));
  for (const bad of ["", "30 7 * *", "60 7 * * *", "30 24 * * *", "0 0 32 * *", "0 0 * 13 *", "0 0 * * 8", "a b c d e", "*/0 * * * *", "5-1 * * * *"]) {
    assert.equal(isCron(bad), false, bad);
  }
});

test("a minute matches in Colombo time, whatever the server is set to", () => {
  // 07:30 in Colombo is 02:00 UTC; a scheduler reading UTC would fire at the wrong hour.
  assert.ok(cronMatches("30 7 * * *", colombo("2026-09-22T07:30:00")));
  assert.equal(cronMatches("30 7 * * *", new Date("2026-09-22T07:30:00Z")), false);
  assert.equal(cronMatches("30 7 * * *", colombo("2026-09-22T07:31:00")), false);
  assert.ok(cronMatches("*/15 * * * *", colombo("2026-09-22T13:45:00")));
  assert.equal(cronMatches("*/15 * * * *", colombo("2026-09-22T13:46:00")), false);
});

test("a day of the week is Sunday at 0 and at 7, and midnight is hour 0", () => {
  assert.ok(cronMatches("0 9 * * 0", colombo("2026-09-20T09:00:00")), "Sunday as 0");
  assert.ok(cronMatches("0 9 * * 7", colombo("2026-09-20T09:00:00")), "Sunday as 7");
  assert.ok(cronMatches("0 0 * * *", colombo("2026-09-22T00:00:00")), "midnight");
  assert.equal(clockParts(colombo("2026-09-22T00:05:00")).hour, 0);
});

test("a day of the month and a day of the week together mean either, as a crontab means it", () => {
  assert.ok(cronMatches("0 9 1 * mon", colombo("2026-09-01T09:00:00")), "the first, a Tuesday");
  assert.ok(cronMatches("0 9 1 * mon", colombo("2026-09-07T09:00:00")), "a Monday, not the first");
  assert.equal(cronMatches("0 9 1 * mon", colombo("2026-09-08T09:00:00")), false);
  // Only one of them restricted keeps the plain meaning.
  assert.equal(cronMatches("0 9 15 * *", colombo("2026-09-16T09:00:00")), false);
});

test("the next run is found, and an expression that never fires says so", () => {
  const from = colombo("2026-09-22T08:00:00");
  assert.equal(nextRun("30 7 * * *", from)?.toISOString(), colombo("2026-09-23T07:30:00").toISOString());
  assert.equal(nextRun("0 9 * * mon", from)?.toISOString(), colombo("2026-09-28T09:00:00").toISOString());
  // The 30th of February never comes.
  assert.equal(nextRun("0 9 30 2 *", from), null);
  assert.equal(nextRun("nonsense", from), null);
});

test("the last minute an expression fired is found, or said not to be in the window", () => {
  const now = colombo("2026-09-22T09:15:00");
  assert.equal(previousRun("30 7 * * *", now)?.toISOString(), colombo("2026-09-22T07:30:00").toISOString());
  // Yesterday's, when today's has not come round yet.
  assert.equal(previousRun("30 7 * * *", colombo("2026-09-22T06:00:00"))?.toISOString(), colombo("2026-09-21T07:30:00").toISOString());
  // A window too short to reach back to it says so, which is how a missed run stops being owed.
  assert.equal(previousRun("30 7 * * *", now, 60), null);
  assert.equal(previousRun("nonsense", now), null);
});

test("an expression says itself in words the owner can check", () => {
  assert.equal(describeCron("30 7 * * *"), "Every day at 07:30");
  assert.equal(describeCron("0 9 * * 1"), "Every Monday at 09:00");
  assert.equal(describeCron("0 9 * * 1,3"), "Every Monday and Wednesday at 09:00");
  assert.equal(describeCron("0 * * * *"), "Every hour, on the hour");
  assert.equal(describeCron("15 */4 * * *"), "Every 4 hours, at 15 minutes past");
  assert.equal(describeCron("0 0 1,15 * *"), "On the 1st and 15th of the month at 00:00");
  assert.equal(describeCron("30 7,19 * * *"), "Every day at 07:30 and 19:30");
  assert.equal(describeCron("* * * * *"), "Every minute");
  assert.equal(describeCron("0 9 1 1 *"), "Cron: 0 9 1 1 *");
  assert.equal(describeCron("nope"), "Never");
});

test("the shapes the admin offers compile to expressions that mean what they say", () => {
  assert.equal(cronFromForm({ kind: "daily", at: "07:30" }), "30 7 * * *");
  assert.equal(cronFromForm({ kind: "weekly", at: "09:00", weekdays: [3, 1] }), "0 9 * * 1,3");
  assert.equal(cronFromForm({ kind: "monthly", at: "06:15", days: [15, 1] }), "15 6 1,15 * *");
  assert.equal(cronFromForm({ kind: "hourly", minute: 5 }), "5 * * * *");
  assert.equal(cronFromForm({ kind: "every_n_hours", hours: 6, minute: 0 }), "0 */6 * * *");
  assert.equal(cronFromForm({ kind: "cron", expression: "  0 9 * * *  " }), "0 9 * * *");
  assert.ok(parseCron(cronFromForm({ kind: "weekly", at: "09:00", weekdays: [] })), "a week with no day named still parses");
});
