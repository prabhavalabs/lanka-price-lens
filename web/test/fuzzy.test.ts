import assert from "node:assert/strict";
import test from "node:test";

import { editDistance, fuzzySearch, normalize } from "../src/lib/fuzzy.ts";

const items = [
  { id: "product_potato", label: "Potato", terms: ["POTATOES", "Potato (Imp)", "අල"] },
  { id: "product_sweet_potato", label: "Sweet Potato", terms: ["Bathala"] },
  { id: "product_big_onion", label: "Big Onion", terms: ["B'Onion Imported", "Big Onions"] },
  { id: "product_red_onion", label: "Red Onion", terms: ["Red Onions", "Rathu Loonu"] },
  { id: "product_dhal", label: "Red Dhal (Masoor)", terms: ["Dhal", "Parippu", "Mysoor Dhal"] },
  { id: "product_chicken", label: "Chicken", terms: ["Bairaha Whole Chicken"] },
];

test("fuzzy search forgives a shopper's spelling and ranks the plain name first", () => {
  assert.equal(normalize("B'Onion  Imported!"), "bonion imported");
  assert.equal(editDistance("potato", "potatos"), 1);
  assert.equal(editDistance("onoin", "onion"), 1, "a swapped pair counts once");
  assert.equal(editDistance("chicken", "rice"), 3, "capped distances stop early");

  assert.deepEqual(fuzzySearch(items, "potato").map((match) => match.item.id), ["product_potato", "product_sweet_potato"]);
  assert.equal(fuzzySearch(items, "potatos")[0]?.item.id, "product_potato", "a typo still finds it");
  assert.equal(fuzzySearch(items, "b onion")[0]?.item.id, "product_big_onion", "the bulletin's own wording works");
  assert.equal(fuzzySearch(items, "parippu")[0]?.item.id, "product_dhal", "a Sinhala name in Latin letters works through the aliases");
  assert.equal(fuzzySearch(items, "onoin")[0]?.item.label.endsWith("Onion"), true);
  assert.deepEqual(fuzzySearch(items, "xyzzy"), [], "nonsense finds nothing");
  assert.equal(fuzzySearch(items, "chick")[0]?.item.id, "product_chicken");
  assert.equal(fuzzySearch(items, "onion", 1).length, 1, "the limit holds");
});
