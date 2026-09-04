import assert from "node:assert/strict";
import test from "node:test";

import { damerauLevenshtein, fuzzyScore, fuzzySearch, normalize } from "../src/lib/fuzzy.ts";

const products = [
  { id: "product_tomato", label: "Tomato", category: "vegetable" },
  { id: "product_potato", label: "Potato", category: "vegetable" },
  { id: "product_green_chillies", label: "Green Chillies", category: "vegetable" },
  { id: "product_mango", label: "Mango", category: "fruit" },
  { id: "item_mango_kara", label: "Mango — Karathakolomban", category: "fruit" },
  { id: "product_ladies_fingers", label: "Ladies Fingers", category: "vegetable" },
];
const search = (query: string) => fuzzySearch(query, products, (product) => [product.label, product.category]).map((result) => result.item.id);

test("normalize strips punctuation, case, and diacritics", () => {
  assert.equal(normalize("Mango — Karathakolomban"), "mango karathakolomban");
  assert.equal(normalize("Café  Crème!"), "cafe creme");
});

test("exact and prefix matches outrank substrings and subsequences", () => {
  assert.equal(search("tomato")[0], "product_tomato");
  assert.equal(search("pot")[0], "product_potato");
  assert.equal(search("kara")[0], "item_mango_kara");
  assert.ok(fuzzyScore("tomato", "Tomato") > fuzzyScore("tomato", "Tomato Paste"));
});

test("typos and abbreviations still find the product", () => {
  assert.equal(search("tomatoe")[0], "product_tomato");
  assert.equal(search("potatp")[0], "product_potato");
  assert.equal(search("grn chil")[0], "product_green_chillies");
  assert.equal(search("ldies")[0], "product_ladies_fingers");
});

test("every query token must match and empty queries return nothing", () => {
  assert.deepEqual(search("mango zzzz"), []);
  assert.deepEqual(search("   "), []);
  assert.ok(search("fruit").includes("product_mango"));
});

test("damerau-levenshtein counts transpositions as one edit", () => {
  assert.equal(damerauLevenshtein("potato", "potato"), 0);
  assert.equal(damerauLevenshtein("potato", "potaot"), 1);
  assert.equal(damerauLevenshtein("kitten", "sitting"), 3);
});
