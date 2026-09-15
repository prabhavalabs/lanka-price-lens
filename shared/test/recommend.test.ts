import assert from "node:assert/strict";
import test from "node:test";

import { explainPick, pickDaily, pickSurprise, preferencesSchema, scoreDish, suitable, type AccountPreferences, type DishFacts } from "../src/index.ts";

const dish = (id: string, overrides: Partial<DishFacts> = {}): DishFacts => ({ id, category: "vegetable", diet: [], tags: [], kcal_per_serving: null, minutes: null, popularity: 2, ...overrides });
const prefer = (input: Partial<AccountPreferences> = {}): AccountPreferences => preferencesSchema.parse(input);

const parippu = dish("dish_parippu", { category: "pulses_and_eggs", diet: ["vegetarian", "vegan", "gluten_free"], tags: ["budget", "kid_friendly", "high_protein"], minutes: 25, popularity: 1 });
const curd = dish("dish_curd", { category: "sweet", diet: ["vegetarian", "gluten_free", "contains_dairy"], tags: ["high_sugar"], minutes: 10, popularity: 2 });
const omelette = dish("dish_omelette", { category: "pulses_and_eggs", diet: ["vegetarian", "gluten_free", "contains_egg"], tags: ["quick", "high_protein"], minutes: 15, popularity: 1 });
const ambulThiyal = dish("dish_ambul_thiyal", { category: "fish_and_seafood", diet: ["gluten_free", "contains_fish"], tags: ["high_protein"], minutes: 60, popularity: 2 });
const chickenCurry = dish("dish_chicken_curry", { category: "meat_and_poultry", diet: ["gluten_free", "contains_meat"], tags: ["comfort", "filling", "high_protein"], minutes: 55, popularity: 1 });
const kavum = dish("dish_kavum", { category: "sweet", diet: ["vegetarian", "vegan"], tags: ["festive", "deep_fried", "high_sugar"], minutes: 90, popularity: 3 });
const roti = dish("dish_roti", { category: "rice_and_grains", diet: ["vegetarian", "vegan"], tags: ["quick", "budget"], minutes: 30, popularity: 1 });
const all = [parippu, curd, omelette, ambulThiyal, chickenCurry, kavum, roti];

test("no preferences: every dish qualifies and popularity alone decides the weights", () => {
  const none = prefer();
  assert.ok(all.every((candidate) => suitable(candidate, none)));
  assert.equal(scoreDish(parippu, none), 3);
  assert.equal(scoreDish(curd, none), 2);
  assert.equal(scoreDish(kavum, none), 1);
  assert.deepEqual(explainPick(kavum, none), [], "nothing to say about an occasional sweet that takes an hour and a half");
  assert.deepEqual(explainPick(parippu, none), ["under 30 minutes", "popular"]);
});

test("the diet is a hard filter: vegetarian takes vegan dishes too, vegan only vegan, pescatarian anything without meat", () => {
  const vegetarian = prefer({ diet: "vegetarian" });
  assert.deepEqual(all.filter((candidate) => suitable(candidate, vegetarian)).map((candidate) => candidate.id), ["dish_parippu", "dish_curd", "dish_omelette", "dish_kavum", "dish_roti"]);
  const vegan = prefer({ diet: "vegan" });
  assert.deepEqual(all.filter((candidate) => suitable(candidate, vegan)).map((candidate) => candidate.id), ["dish_parippu", "dish_kavum", "dish_roti"]);
  const pescatarian = prefer({ diet: "pescatarian" });
  assert.equal(suitable(ambulThiyal, pescatarian), true);
  assert.equal(suitable(chickenCurry, pescatarian), false);
  assert.equal(suitable(dish("dish_untagged"), pescatarian), true, "a dish with no diet tags has no meat");
  assert.equal(suitable(dish("dish_untagged"), vegetarian), false, "but it is not known to be vegetarian");
});

test("avoiding egg, dairy, fish, or meat drops dishes that contain them; avoiding gluten keeps only gluten-free dishes", () => {
  assert.equal(suitable(omelette, prefer({ avoid: ["egg"] })), false);
  assert.equal(suitable(parippu, prefer({ avoid: ["egg"] })), true);
  assert.equal(suitable(curd, prefer({ avoid: ["dairy"] })), false);
  assert.equal(suitable(ambulThiyal, prefer({ avoid: ["fish"] })), false);
  assert.equal(suitable(chickenCurry, prefer({ avoid: ["meat"] })), false);
  assert.equal(suitable(ambulThiyal, prefer({ avoid: ["meat"] })), true, "fish is not meat");
  assert.equal(suitable(roti, prefer({ avoid: ["gluten"] })), false, "wheat roti carries no gluten_free tag");
  assert.equal(suitable(parippu, prefer({ avoid: ["gluten"] })), true);
  assert.equal(suitable(parippu, prefer({ avoid: ["egg", "dairy", "fish", "meat", "gluten"] })), true, "every avoid holds together");
  assert.equal(suitable(omelette, prefer({ diet: "vegetarian", avoid: ["egg"] })), false, "diet and avoid both apply");
});

test("goals score rather than filter: matching tags add points, penalty tags take more away", () => {
  const weightLoss = prefer({ goals: ["weight_loss"] });
  const light = dish("dish_light", { tags: ["weight_loss_friendly", "low_calorie", "light"] });
  assert.equal(scoreDish(light, weightLoss), 2 + 3 * 2, "three matching tags on a common dish");
  assert.equal(scoreDish(kavum, weightLoss), 1 - 2 * 3, "deep fried and high in sugar count against it, but it still qualifies");
  assert.equal(suitable(kavum, weightLoss), true);
  assert.equal(scoreDish(parippu, prefer({ goals: ["high_protein"] })), 3 + 2);
  assert.equal(scoreDish(curd, prefer({ goals: ["diabetic_friendly"] })), 2 - 3, "high sugar counts against the diabetic goal");
  assert.equal(scoreDish(dish("dish_d", { tags: ["diabetic_friendly"] }), prefer({ goals: ["diabetic_friendly"] })), 2 + 2);
  assert.equal(scoreDish(dish("dish_h", { tags: ["heart_healthy", "high_sodium", "deep_fried"] }), prefer({ goals: ["heart_healthy"] })), 2 + 2 - 6);
  assert.equal(scoreDish(roti, prefer({ goals: ["budget", "quick"] })), 3 + 2 + 2);
  assert.equal(scoreDish(dish("dish_pot", { tags: ["one_pot"] }), prefer({ goals: ["quick"] })), 2 + 2, "one pot counts as quick");
  assert.equal(scoreDish(parippu, prefer({ goals: ["kid_friendly"] })), 3 + 2);
  assert.equal(scoreDish(chickenCurry, prefer({ goals: ["comfort"] })), 3 + 4, "comfort and filling both count");
  assert.equal(scoreDish(ambulThiyal, prefer({ goals: ["comfort", "budget", "quick"] })), 2, "goals a dish does not meet neither add nor take away");
});

test("favourite kinds of dish add a bonus to dishes of that category", () => {
  const likesPulses = prefer({ likes: ["pulses_and_eggs"] });
  assert.equal(scoreDish(parippu, likesPulses), 3 + 2);
  assert.equal(scoreDish(roti, likesPulses), 3);
  assert.equal(scoreDish(roti, prefer({ likes: ["rice_and_grains", "pulses_and_eggs"] })), 3 + 2, "one category per dish, one bonus");
});

test("explainPick says why in short phrases: diet, avoid, goals met, time, a favourite kind, popularity", () => {
  const preferences = prefer({ diet: "vegetarian", avoid: ["meat", "gluten"], goals: ["budget", "quick", "heart_healthy"], likes: ["pulses_and_eggs"] });
  assert.deepEqual(explainPick(parippu, preferences), ["vegetarian", "no meat", "gluten free", "easy on the budget", "under 30 minutes", "you like pulses and eggs", "popular"]);
  assert.deepEqual(explainPick(roti, prefer({ goals: ["quick"] })), ["under 30 minutes", "popular"], "the minutes line stands in for the quick goal");
  assert.deepEqual(explainPick(dish("dish_pot", { tags: ["one_pot"], minutes: 45 }), prefer({ goals: ["quick"] })), ["quick to make"], "a quick tag on a longer dish keeps the goal phrase");
  assert.deepEqual(explainPick(chickenCurry, prefer({ diet: "pescatarian", goals: ["comfort", "high_protein"], likes: ["meat_and_poultry"] })), ["comfort food", "high protein", "you like meat and poultry", "popular"], "a dish that fails the diet never earns the diet phrase");
  assert.deepEqual(explainPick(kavum, prefer({ diet: "vegan", goals: ["weight_loss"] })), ["vegan"], "penalty tags earn no phrase");
});

test("pickSurprise draws only suitable dishes, repeats for a seed, and honours the exclusion", () => {
  const vegan = prefer({ diet: "vegan" });
  for (let round = 0; round < 50; round += 1) {
    const pick = pickSurprise(all, vegan);
    assert.ok(pick && ["dish_parippu", "dish_kavum", "dish_roti"].includes(pick.id), `an unseeded draw stays within the vegan dishes (got ${pick?.id})`);
  }
  const first = pickSurprise(all, vegan, { seed: "tab-1" });
  for (let round = 0; round < 10; round += 1) assert.equal(pickSurprise(all, vegan, { seed: "tab-1" })?.id, first?.id, "the same seed draws the same dish");
  const seen = new Set<string>();
  for (let round = 0; round < 200; round += 1) seen.add(pickSurprise(all, vegan, { seed: `seed-${round}` })!.id);
  assert.deepEqual([...seen].sort(), ["dish_kavum", "dish_parippu", "dish_roti"], "different seeds reach every suitable dish");
  assert.equal(pickSurprise(all, vegan, { exclude: ["dish_parippu", "dish_roti"] })?.id, "dish_kavum");
  assert.equal(pickSurprise(all, vegan, { exclude: new Set(["dish_parippu", "dish_roti", "dish_kavum"]) }), null, "nothing left to pick");
  assert.equal(pickSurprise([], prefer()), null);
  assert.equal(pickSurprise(all, prefer({ diet: "vegan", avoid: ["gluten"] }), { exclude: ["dish_parippu"] }), null, "the filters and the exclusion together can leave nothing");
});

test("pickSurprise weights the draw by score: an everyday dish comes up far more often than an occasional one", () => {
  const tally = new Map<string, number>();
  const pool = [dish("dish_everyday", { popularity: 1 }), dish("dish_occasional", { popularity: 3 })];
  for (let round = 0; round < 2_000; round += 1) {
    const pick = pickSurprise(pool, prefer(), { seed: `round-${round}` })!;
    tally.set(pick.id, (tally.get(pick.id) ?? 0) + 1);
  }
  const everyday = tally.get("dish_everyday") ?? 0;
  const occasional = tally.get("dish_occasional") ?? 0;
  assert.ok(everyday > occasional * 2, `weights 3 against 1: ${everyday} against ${occasional}`);
  assert.ok(occasional > 200, "the occasional dish still comes up");
  const penalised = [dish("dish_fried", { popularity: 1, tags: ["deep_fried", "high_sugar"] }), dish("dish_plain", { popularity: 3 })];
  const counts = { fried: 0, plain: 0 };
  for (let round = 0; round < 1_000; round += 1) {
    const pick = pickSurprise(penalised, prefer({ goals: ["weight_loss"] }), { seed: `round-${round}` })!;
    if (pick.id === "dish_fried") counts.fried += 1;
    else counts.plain += 1;
  }
  assert.ok(counts.fried > 300 && counts.plain > 300, `a negative score floors to one, so both stay in play: ${JSON.stringify(counts)}`);
});

test("pickDaily is deterministic for its seed, never repeats an excluded id, and spreads the picks over categories", () => {
  const preferences = prefer({ diet: "vegetarian" });
  const day = pickDaily(all, preferences, { exclude: [], count: 3, seed: "2026-09-14:account_alice" });
  assert.equal(day.length, 3);
  assert.deepEqual(day.map((pick) => pick.id), pickDaily(all, preferences, { exclude: [], count: 3, seed: "2026-09-14:account_alice" }).map((pick) => pick.id), "the same seed gives the same three");
  assert.equal(new Set(day.map((pick) => pick.category)).size, 3, "three picks, three kinds of dish");
  assert.equal(new Set(day.map((pick) => pick.id)).size, 3, "no dish twice");
  const differentDay = pickDaily(all, preferences, { exclude: [], count: 3, seed: "2026-09-15:account_alice" });
  const differentAccount = pickDaily(all, preferences, { exclude: [], count: 3, seed: "2026-09-14:account_bob" });
  const variety = new Set([day, differentDay, differentAccount].map((picks) => picks.map((pick) => pick.id).join(",")));
  assert.ok(variety.size >= 2, "another day or another account draws differently");
  const recent = ["dish_parippu", "dish_omelette"];
  for (let round = 0; round < 50; round += 1) {
    const picks = pickDaily(all, preferences, { exclude: recent, count: 3, seed: `day-${round}` });
    assert.ok(picks.every((pick) => !recent.includes(pick.id)), "a recently mailed dish is never picked again");
  }
  const vegan = pickDaily(all, prefer({ diet: "vegan" }), { exclude: [], count: 3, seed: "x" });
  assert.deepEqual(vegan.map((pick) => pick.id).sort(), ["dish_kavum", "dish_parippu", "dish_roti"], "exactly the suitable dishes when there are just enough");
  assert.equal(pickDaily(all, prefer({ diet: "vegan" }), { exclude: ["dish_kavum"], count: 3, seed: "x" }).length, 2, "fewer than asked when the pool runs out");
  const sameKind = [dish("dish_a", { category: "sweet" }), dish("dish_b", { category: "sweet" }), dish("dish_c", { category: "sweet" }), dish("dish_d", { category: "drink" })];
  const spread = pickDaily(sameKind, prefer(), { exclude: [], count: 3, seed: "y" });
  assert.equal(spread.length, 3);
  assert.ok(spread.some((pick) => pick.category === "drink"), "the one dish of another kind is always among three picks");
  assert.deepEqual(pickDaily(all, prefer(), { exclude: [], count: 0, seed: "z" }), []);
});
