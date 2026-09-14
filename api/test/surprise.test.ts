import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { preferencesSchema } from "@lanka-pricelens/shared";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import type { Account } from "../src/account/types.ts";
import { buildRecipeIndex } from "../src/recipe-views.ts";
import { readRecipeStore } from "../src/recipes.ts";
import { dishFactsOf, guestPreferences, parseExclude, surpriseRoutes, type SurpriseBindings, type SurprisePick } from "../src/surprise.ts";
import { accountFixture } from "./helpers/accounts.ts";

// The fixture corpus: parippu (vegan, pulses, 25 minutes) and chicken curry (meat, 55 minutes) have recipes; red rice does not.
const store = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));
const index = buildRecipeIndex(store);

const alice = accountFixture({ id: "account_alice", email: "alice@example.com", preferences: preferencesSchema.parse({ diet: "vegetarian", goals: ["budget"], likes: ["pulses_and_eggs"] }) });
const bob = accountFixture({ id: "account_bob", email: "bob@example.com" });
const carol = accountFixture({ id: "account_carol", email: "carol@example.com", preferences: preferencesSchema.parse({ diet: "vegan", avoid: ["meat"] }) });
const accounts = new Map<string, Account>([alice, bob, carol].map((account) => [account.id, account]));

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

/** The route behind a stand-in for readAccount: the x-account header names who is signed in, and nobody is refused. */
function harness() {
  const app = new Hono<SurpriseBindings>();
  app.use("*", requestId());
  app.use("*", async (context, next) => {
    const account = accounts.get(context.req.header("x-account") ?? "");
    if (account) context.set("account", account);
    await next();
  });
  app.route("/v1/public/recipes/surprise", surpriseRoutes({ recipes: store, index }));
  return async (query = "", as?: Account) => {
    const response = await app.request(`http://localhost/v1/public/recipes/surprise${query}`, { headers: as ? { "x-account": as.id } : {} });
    return { status: response.status, cache: response.headers.get("cache-control"), ...((await response.json()) as Envelope<SurprisePick | null>) };
  };
}

test("the facts come from the index: the catalogue's diet and popularity, the recipe's times, the earned tags, the computed calories", () => {
  const parippu = dishFactsOf(index.get("dish_parippu")!);
  assert.equal(parippu.category, "pulses_and_eggs");
  assert.deepEqual(parippu.diet, ["vegetarian", "vegan", "gluten_free"]);
  assert.equal(parippu.minutes, 25);
  assert.equal(parippu.popularity, 1);
  assert.equal(parippu.kcal_per_serving, 281);
  assert.ok(parippu.tags.includes("budget") && parippu.tags.includes("high_protein"), "curated and earned tags both count");
  assert.deepEqual(parseExclude(" dish_parippu, dish_parippu ,Bad Id,dish_x"), ["dish_parippu", "dish_x"]);
  assert.equal(parseExclude(undefined).length, 0);
  assert.equal(parseExclude(Array.from({ length: 80 }, (_, index) => `dish_${index}`).join(",")).length, 50);
  assert.equal(guestPreferences("vegan").diet, "vegan");
  assert.equal(guestPreferences("keto").diet, "everything", "an unknown diet is ignored");
  assert.equal(guestPreferences(undefined).diet, "everything");
});

test("a guest gets one dish that has a full recipe, with its name and reasons, never cached; a seed repeats the draw", async () => {
  const call = harness();
  for (let round = 0; round < 20; round += 1) {
    const answer = await call();
    assert.equal(answer.status, 200);
    assert.equal(answer.cache, "no-store");
    assert.ok(answer.payload && ["dish_parippu", "dish_chicken_curry"].includes(answer.payload.id), "only dishes with a recipe; red rice has none");
    assert.equal(answer.payload.name, store.catalogue.dishes.find((dish) => dish.id === answer.payload!.id)!.names.en);
    assert.ok(answer.payload.reasons.includes("popular"));
  }
  const first = (await call("?seed=tab-abc")).payload!.id;
  for (let round = 0; round < 10; round += 1) assert.equal((await call("?seed=tab-abc")).payload!.id, first);
});

test("a guest may narrow the draw with ?diet=", async () => {
  const call = harness();
  for (let round = 0; round < 10; round += 1) {
    const answer = await call("?diet=vegetarian");
    assert.equal(answer.payload?.id, "dish_parippu");
    assert.deepEqual(answer.payload?.reasons, ["vegetarian", "under 30 minutes", "popular"]);
  }
  assert.equal((await call("?diet=pescatarian&exclude=dish_parippu")).status, 404, "chicken is not for a pescatarian");
  const ignored = await call("?diet=carnivore&exclude=dish_chicken_curry");
  assert.equal(ignored.payload?.id, "dish_parippu", "an unknown diet is ignored rather than refused");
});

test("exclude keeps shown dishes out, and NO_MATCH answers when nothing is left", async () => {
  const call = harness();
  for (let round = 0; round < 10; round += 1) assert.equal((await call("?exclude=dish_parippu")).payload?.id, "dish_chicken_curry");
  const nothing = await call("?exclude=dish_parippu,dish_chicken_curry,dish_red_rice");
  assert.equal(nothing.status, 404);
  assert.equal(nothing.success, false);
  assert.equal(nothing.code, "NO_MATCH");
  assert.equal(nothing.payload, null);
  assert.equal(nothing.cache, "no-store");
});

test("signed in, the account's preferences decide, and the diet query is ignored", async () => {
  const call = harness();
  for (let round = 0; round < 10; round += 1) {
    const answer = await call("?seed=x", alice);
    assert.equal(answer.payload?.id, "dish_parippu", "alice is vegetarian, so never the chicken curry");
    assert.deepEqual(answer.payload?.reasons, ["vegetarian", "easy on the budget", "under 30 minutes", "you like pulses and eggs", "popular"]);
  }
  const bobs = await call("?diet=vegan&exclude=dish_parippu", bob);
  assert.equal(bobs.payload?.id, "dish_chicken_curry", "bob eats everything; a diet in the query does not override the account");
  const carols = await call("?exclude=dish_parippu", carol);
  assert.equal(carols.status, 404);
  assert.equal(carols.code, "NO_MATCH");
  assert.equal((await call("", carol)).payload?.id, "dish_parippu");
});
