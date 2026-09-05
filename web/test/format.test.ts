import assert from "node:assert/strict";
import test from "node:test";

import { categoryLabel, changeLabel, relativeDay, rupeeRange, rupees, unitLabel } from "../src/lib/format.ts";

test("prices, units, dates, and changes read as a shopper expects", () => {
  assert.equal(rupees(1250), "Rs 1,250");
  assert.equal(rupees(12.5), "Rs 12.50");
  assert.equal(rupees(180.4), "Rs 180");
  assert.equal(rupeeRange(180, 220), "Rs 180 – 220");
  assert.equal(rupeeRange(200, 200), "Rs 200");
  assert.equal(unitLabel("kg"), "per kg");
  assert.equal(unitLabel("piece"), "each");
  assert.equal(unitLabel("bottle"), "per bottle");
  assert.equal(categoryLabel("vegetable"), "Vegetables");
  assert.equal(categoryLabel("meat_and_poultry"), "Meat and poultry");
  const today = new Date("2026-09-05T10:00:00Z");
  assert.equal(relativeDay("2026-09-05", today), "today");
  assert.equal(relativeDay("2026-09-04", today), "yesterday");
  assert.equal(relativeDay("2026-09-02", today), "3 days ago");
  assert.equal(relativeDay("2026-08-01", today), "1 Aug");
  assert.deepEqual(changeLabel(12.4), { text: "▲ 12%", direction: "rise" });
  assert.deepEqual(changeLabel(-3.6), { text: "▼ 4%", direction: "fall" });
  assert.deepEqual(changeLabel(0.4), { text: "steady", direction: "steady" });
  assert.equal(changeLabel(null), null);
});
