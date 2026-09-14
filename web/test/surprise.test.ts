import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, describeFailure, type SurprisePick } from "../src/lib/api.ts";
import { drawSurprise, isNoMatch, parseSeen, pickedLabel, readReasons, rememberSeen, seenLimit, surprisePath, type SeenStore } from "../src/lib/surprise.ts";

test("the seen list parses defensively and keeps only the newest ids", () => {
  assert.deepEqual(parseSeen(null), []);
  assert.deepEqual(parseSeen(""), []);
  assert.deepEqual(parseSeen("not json"), []);
  assert.deepEqual(parseSeen('{"a":1}'), []);
  assert.deepEqual(parseSeen('["dish_a", 3, "", null, "dish_b", "dish_a"]'), ["dish_a", "dish_b"], "only non-empty strings, no repeats");
  const many = JSON.stringify(Array.from({ length: seenLimit + 10 }, (_, index) => `dish_${index}`));
  const parsed = parseSeen(many);
  assert.equal(parsed.length, seenLimit);
  assert.equal(parsed[0], "dish_10", "the oldest are dropped first");
  assert.equal(parsed.at(-1), `dish_${seenLimit + 9}`);
});

test("remembering an id puts it last, once, and caps the list", () => {
  assert.deepEqual(rememberSeen([], "dish_a"), ["dish_a"]);
  assert.deepEqual(rememberSeen(["dish_a", "dish_b"], "dish_c"), ["dish_a", "dish_b", "dish_c"]);
  assert.deepEqual(rememberSeen(["dish_a", "dish_b"], "dish_a"), ["dish_b", "dish_a"], "a repeat moves to the end");
  const full = Array.from({ length: seenLimit }, (_, index) => `dish_${index}`);
  const next = rememberSeen(full, "dish_new");
  assert.equal(next.length, seenLimit);
  assert.equal(next[0], "dish_1");
  assert.equal(next.at(-1), "dish_new");
});

test("only a 404 with code NO_MATCH counts as the catalogue running dry", () => {
  assert.ok(isNoMatch(describeFailure(404, "No dish matches", "NO_MATCH")));
  assert.ok(!isNoMatch(describeFailure(404, "Recipe not found")));
  assert.ok(!isNoMatch(describeFailure(500, null, "NO_MATCH")));
  assert.ok(!isNoMatch(new Error("NO_MATCH")));
  assert.ok(!isNoMatch(null));
  assert.equal(describeFailure(404, "x", "NO_MATCH").code, "NO_MATCH");
  assert.equal(describeFailure(404, "x").code, null, "no code unless the API sent one");
});

test("the banner line and the navigation state read plainly", () => {
  assert.equal(pickedLabel([]), "Picked for you");
  assert.equal(pickedLabel(["vegetarian", " under 30 minutes ", ""]), "Picked for you · vegetarian · under 30 minutes");
  assert.deepEqual(readReasons(null), []);
  assert.deepEqual(readReasons("reasons"), []);
  assert.deepEqual(readReasons({ reasons: "vegetarian" }), []);
  assert.deepEqual(readReasons({ reasons: ["vegetarian", 4, "", "quick"] }), ["vegetarian", "quick"]);
  assert.equal(surprisePath("dish_pol sambol"), "/r/dish_pol%20sambol?surprise=1");
});

function memoryStore(initial: string[] = []): SeenStore & { ids: string[] } {
  const store = {
    ids: [...initial],
    load: () => [...store.ids],
    save: (ids: string[]) => { store.ids = [...ids]; },
  };
  return store;
}

const noMatch = () => new ApiError(404, "No dish matches", false, "NO_MATCH");

test("a draw leaves out what the tab has seen and remembers the pick", async () => {
  const seen = memoryStore(["dish_a", "dish_b"]);
  const calls: Array<{ exclude: string[]; diet?: string | undefined }> = [];
  const fetch = async (input: { exclude: string[]; diet?: string | undefined }): Promise<SurprisePick> => {
    calls.push(input);
    return { id: "dish_c", name: "Kiribath", reasons: ["vegetarian"] };
  };
  const pick = await drawSurprise({ diet: "vegetarian" }, { fetch, seen });
  assert.deepEqual(pick, { id: "dish_c", name: "Kiribath", reasons: ["vegetarian"] });
  assert.deepEqual(calls, [{ exclude: ["dish_a", "dish_b"], diet: "vegetarian" }]);
  assert.deepEqual(seen.ids, ["dish_a", "dish_b", "dish_c"]);
});

test("when the catalogue runs dry the tab starts over once, then gives up", async () => {
  const seen = memoryStore(["dish_a", "dish_b"]);
  const excludes: string[][] = [];
  const fetch = async ({ exclude }: { exclude: string[] }): Promise<SurprisePick> => {
    excludes.push(exclude);
    if (exclude.length) throw noMatch();
    return { id: "dish_a", name: "Again", reasons: [] };
  };
  const pick = await drawSurprise({}, { fetch, seen });
  assert.equal(pick?.id, "dish_a");
  assert.deepEqual(excludes, [["dish_a", "dish_b"], []], "one retry without exclusions");
  assert.deepEqual(seen.ids, ["dish_a"], "the list was cleared before the retry");

  const empty = memoryStore(["dish_a"]);
  let attempts = 0;
  const dry = async (): Promise<SurprisePick> => { attempts += 1; throw noMatch(); };
  assert.equal(await drawSurprise({}, { fetch: dry, seen: empty }), null);
  assert.equal(attempts, 2);
  assert.deepEqual(empty.ids, []);

  const fresh = memoryStore();
  attempts = 0;
  assert.equal(await drawSurprise({}, { fetch: dry, seen: fresh }), null, "nothing seen: no retry to make");
  assert.equal(attempts, 1);
});

test("any other failure comes through as it was", async () => {
  const seen = memoryStore(["dish_a"]);
  const fetch = async (): Promise<SurprisePick> => { throw describeFailure(503, null); };
  await assert.rejects(drawSurprise({}, { fetch, seen }), (error: unknown) => error instanceof ApiError && error.status === 503);
  assert.deepEqual(seen.ids, ["dish_a"], "the list is untouched");
});
