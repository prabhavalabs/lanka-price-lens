import assert from "node:assert/strict";
import test from "node:test";

import { labelWords, packWords } from "../src/lib/offers.ts";

test("offer cards word the pack as a shopper would and calm a shouted label", () => {
  assert.equal(packWords("1000 g"), "for 1 kg");
  assert.equal(packWords("250 g"), "for 250 g");
  assert.equal(packWords("1500 ml"), "for 1.5 l");
  assert.equal(packWords("18 piece"), "for 18 pieces");
  assert.equal(packWords("1 piece"), "", "a single piece adds nothing beside the name");
  assert.equal(packWords("1 kg"), "for 1 kg");
  assert.equal(packWords("a bunch"), "for a bunch");
  assert.equal(labelWords("RED ONION (LOCAL)"), "Red Onion (Local)");
  assert.equal(labelWords("DRUMSTICKS"), "Drumsticks");
  assert.equal(labelWords("Anchor Red Cowpea"), "Anchor Red Cowpea", "the store's own casing is left alone");
  assert.equal(labelWords("Mum`S Joy 1L"), "Mum`S Joy 1L");
});
