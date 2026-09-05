import assert from "node:assert/strict";
import test from "node:test";

import { addLine, clearLines, countOf, formatQuantity, minimumFor, removeLine, setQuantity, stepFor, type BasketState } from "../src/store/basket.ts";

test("the basket holds decimal quantities in the priced unit, steps by unit, and removes below the minimum", () => {
  let state: BasketState = { lines: [] };
  state = addLine(state, "product_potato", "Potato", "kg");
  state = addLine(state, "product_potato", "Potato", "kg", 0.5);
  state = addLine(state, "product_egg", "Egg", "piece", 6);
  state = addLine(state, "product_coconut_oil", "Coconut oil", "l", 0.75);
  assert.deepEqual(state.lines.map((line) => [line.id, line.quantity, line.unit]), [["product_potato", 1.5, "kg"], ["product_egg", 6, "piece"], ["product_coconut_oil", 0.75, "l"]]);
  assert.equal(countOf(state), 3, "the badge counts products, not kilos");
  state = setQuantity(state, "product_potato", 0.3);
  assert.equal(state.lines[0]?.quantity, 0.3);
  state = setQuantity(state, "product_potato", 0.02);
  assert.deepEqual(state.lines.map((line) => line.id), ["product_egg", "product_coconut_oil"], "below 50 g the line goes");
  state = setQuantity(state, "product_egg", 2.6);
  assert.equal(state.lines[0]?.quantity, 3, "pieces are whole");
  state = setQuantity(state, "product_egg", 5000);
  assert.equal(state.lines[0]?.quantity, 999, "quantities are capped");
  state = setQuantity(state, "product_egg", 0);
  assert.deepEqual(state.lines.map((line) => line.id), ["product_coconut_oil"], "zero removes the line");
  state = removeLine(state, "product_missing");
  assert.equal(state.lines.length, 1);
  assert.deepEqual(clearLines(), { lines: [] });
  assert.deepEqual([stepFor("kg"), stepFor("l"), stepFor("piece"), stepFor("unit")], [0.25, 0.25, 1, 1]);
  assert.deepEqual([minimumFor("kg"), minimumFor("piece")], [0.05, 1]);
});

test("quantities read the way a shopper writes them", () => {
  assert.equal(formatQuantity(0.5, "kg"), "500 g");
  assert.equal(formatQuantity(1.5, "kg"), "1.5 kg");
  assert.equal(formatQuantity(0.75, "l"), "750 ml");
  assert.equal(formatQuantity(2, "l"), "2 l");
  assert.equal(formatQuantity(1, "piece"), "1 pc");
  assert.equal(formatQuantity(6, "piece"), "6 pcs");
  assert.equal(formatQuantity(3, "bunch"), "3 ×");
});
