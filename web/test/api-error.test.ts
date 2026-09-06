import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, describeFailure } from "../src/lib/api.ts";

test("a failed request is described for the visitor, and only failures that can pass are retryable", () => {
  const cases: Array<[number, string | null, boolean, RegExp]> = [
    [0, null, true, /reach PriceLens/u],
    [404, "Product not found", false, /^Product not found$/u],
    [404, null, false, /Nothing here/u],
    [429, null, true, /Too many requests/u],
    [502, null, true, /restarting|unavailable/u],
    [503, "Service Unavailable", true, /restarting|unavailable/u],
    [500, null, true, /our side/u],
    [400, "Bad basket", false, /^Bad basket$/u],
    [418, null, false, /Request failed \(418\)/u],
  ];
  for (const [status, message, retryable, pattern] of cases) {
    const failure = describeFailure(status, message);
    assert.ok(failure instanceof ApiError, `${status} is an ApiError`);
    assert.equal(failure.status, status);
    assert.equal(failure.retryable, retryable, `${status} retryable`);
    assert.match(failure.message, pattern, `${status} message`);
  }
});
