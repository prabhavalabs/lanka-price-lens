import assert from "node:assert/strict";
import test from "node:test";

import { paginationItems } from "../src/lib/pagination.ts";

test("pagination keeps the ends and nearby pages visible", () => {
  assert.deepEqual(paginationItems(1, 153), [1, 2, 3, 4, "end-ellipsis", 153]);
  assert.deepEqual(paginationItems(77, 153), [1, "start-ellipsis", 76, 77, 78, "end-ellipsis", 153]);
  assert.deepEqual(paginationItems(153, 153), [1, "start-ellipsis", 150, 151, 152, 153]);
  assert.deepEqual(paginationItems(4, 6), [1, 2, 3, 4, 5, 6]);
});
