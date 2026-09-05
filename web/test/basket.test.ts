import assert from "node:assert/strict";
import test from "node:test";

import { addLine, clearLines, countOf, removeLine, setQuantity, type BasketState } from "../src/store/basket.ts";

test("the basket's transitions add, adjust, remove at zero, and count", () => {
  let state: BasketState = { lines: [] };
  state = addLine(state, "product_potato", "Potato");
  state = addLine(state, "product_potato", "Potato");
  state = addLine(state, "product_egg", "Egg", 12);
  assert.deepEqual(state.lines, [{ id: "product_potato", label: "Potato", quantity: 2 }, { id: "product_egg", label: "Egg", quantity: 12 }]);
  assert.equal(countOf(state), 14);
  state = setQuantity(state, "product_potato", 1);
  state = setQuantity(state, "product_potato", 0);
  assert.deepEqual(state.lines.map((line) => line.id), ["product_egg"], "zero removes the line");
  state = setQuantity(state, "product_egg", 500);
  assert.equal(state.lines[0]?.quantity, 99, "quantities are capped");
  state = removeLine(state, "product_missing");
  assert.equal(state.lines.length, 1);
  assert.deepEqual(clearLines(), { lines: [] });
});
