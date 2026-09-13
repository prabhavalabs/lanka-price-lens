import assert from "node:assert/strict";
import test from "node:test";

import { activeFilterCount, emptySearch, readSearch, writeSearch } from "../src/lib/recipe-search.ts";

test("a search round-trips through the address and writes only what differs from the defaults", () => {
  const params = new URLSearchParams("q=parippu&tags=budget,quick&max_kcal=250&sort=kcal&page=2&min_protein=abc");
  const search = readSearch(params);
  assert.deepEqual(search, { q: "parippu", category: "", tags: ["budget", "quick"], max_kcal: 250, min_protein: null, max_minutes: null, max_cost: null, sort: "kcal", page: 2 });
  assert.equal(writeSearch(search).toString(), "q=parippu&tags=budget%2Cquick&max_kcal=250&sort=kcal&page=2");
  assert.equal(writeSearch(emptySearch).toString(), "", "a plain visit is a plain address");
  assert.equal(activeFilterCount(search), 3, "two tags and a calorie cap; the text and the sort are not filters");
  assert.equal(readSearch(new URLSearchParams("page=0&max_cost=-5")).page, 1);
});
