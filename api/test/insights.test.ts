import assert from "node:assert/strict";
import test from "node:test";

import { enrichPoints, linearTrend, monthlySummary, parseRangeRequest } from "../src/insights.ts";

test("range requests accept presets or bounded custom windows", () => {
  assert.deepEqual(parseRangeRequest({}), { kind: "preset", days: 90 });
  assert.deepEqual(parseRangeRequest({ days: "30" }), { kind: "preset", days: 30 });
  assert.deepEqual(parseRangeRequest({ from: "2026-04-01", to: "2026-06-30" }), { kind: "custom", from: "2026-04-01", to: "2026-06-30" });
  assert.ok("error" in parseRangeRequest({ days: "45" }));
  assert.ok("error" in parseRangeRequest({ from: "2026-06-30", to: "2026-04-01" }));
  assert.ok("error" in parseRangeRequest({ from: "2026-02-30", to: "2026-04-01" }));
  assert.ok("error" in parseRangeRequest({ from: "2020-01-01", to: "2026-04-01" }));
  assert.ok("error" in parseRangeRequest({ from: "2026-04-01" }));
});

test("points gain a seven-day moving average and an index against the first trading week", () => {
  const points = enrichPoints(Array.from({ length: 9 }, (_, index) => ({ date: `2026-05-${String(index + 1).padStart(2, "0")}`, average: 100 + index * 10, low: 90, high: 120, markets: 3 })));
  assert.equal(points[0]!.moving_average, null);
  assert.equal(points[6]!.moving_average, 130);
  assert.equal(points[8]!.moving_average, 150);
  assert.equal(points[0]!.index, round1(100 / 130 * 100));
  assert.equal(points[8]!.index, round1(180 / 130 * 100));
});

test("linear trend classifies rising, falling, and stable series", () => {
  const rising = linearTrend(Array.from({ length: 10 }, (_, index) => ({ date: `2026-05-${String(index + 1).padStart(2, "0")}`, average: 100 + index * 5 })));
  assert.equal(rising?.direction, "rising");
  assert.ok((rising?.change_pct_per_30_days ?? 0) > 3);
  const falling = linearTrend(Array.from({ length: 10 }, (_, index) => ({ date: `2026-05-${String(index + 1).padStart(2, "0")}`, average: 200 - index * 5 })));
  assert.equal(falling?.direction, "falling");
  const stable = linearTrend(Array.from({ length: 10 }, (_, index) => ({ date: `2026-05-${String(index + 1).padStart(2, "0")}`, average: 150 + (index % 2) })));
  assert.equal(stable?.direction, "stable");
  assert.equal(linearTrend([{ date: "2026-05-01", average: 1 }]), null);
});

test("monthly summary reports month-over-month change", () => {
  const monthly = monthlySummary(enrichPoints([
    { date: "2026-05-30", average: 100, low: 80, high: 120, markets: 2 },
    { date: "2026-05-31", average: 110, low: 90, high: 130, markets: 2 },
    { date: "2026-06-01", average: 126, low: 100, high: 140, markets: 2 },
  ]));
  assert.equal(monthly.length, 2);
  assert.equal(monthly[0]!.average, 105);
  assert.equal(monthly[0]!.change_pct, null);
  assert.equal(monthly[1]!.change_pct, 20);
  assert.equal(monthly[1]!.trading_days, 1);
});

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
