import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { openOperationalDatabase } from "@lanka-pricelens/foundry/db";
import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import { sourceManifestSchema, type AccountMenu, type SourceManifest, type UserRecipe, type UserRecipeInput } from "@lanka-pricelens/shared";
import { Hono } from "hono";
import { requestId } from "hono/request-id";

import { createContentStore, menuLimit, recipeLimit } from "../src/account/content.ts";
import { contentRoutes, type ContentBindings } from "../src/account/content-routes.ts";
import type { Account } from "../src/account/types.ts";
import type { RecipeView } from "../src/recipe-views.ts";
import { readRecipeStore, type RecipeStore } from "../src/recipes.ts";
import { accountFixture, ensureAccountTables, insertAccount } from "./helpers/accounts.ts";
import { seed, warehouseFor } from "./helpers/warehouse.ts";

const store = readRecipeStore(resolve(import.meta.dirname, "fixtures/recipes"));

const alice = accountFixture({ id: "account_alice", email: "alice@example.com" });
const bob = accountFixture({ id: "account_bob", email: "bob@example.com" });
const carol = accountFixture({ id: "account_carol", email: "carol@example.com", email_verified_at: null });
const accounts = new Map<string, Account>([alice, bob, carol].map((account) => [account.id, account]));

type Envelope<T> = { success: boolean; message: string; payload: T; code?: string };

/** The routes behind a stand-in for requireAccount: the x-account header names who is signed in. */
function harness(options: { recipes?: RecipeStore | undefined; warehouse?: (() => Promise<WarehouseClient | null>) | undefined; published?: (() => SourceManifest[]) | undefined } = {}) {
  const database = openOperationalDatabase(":memory:");
  ensureAccountTables(database);
  for (const account of accounts.values()) insertAccount(database, account);
  const content = createContentStore(database);
  const app = new Hono<ContentBindings>();
  app.use("*", requestId());
  app.use("*", async (context, next) => {
    const account = accounts.get(context.req.header("x-account") ?? "");
    if (!account) return context.json({ success: false, message: "Sign in to continue", payload: null }, 401);
    context.set("account", account);
    await next();
  });
  app.route("/v1/account", contentRoutes({ content, recipes: "recipes" in options ? options.recipes : store, warehouse: options.warehouse ?? (async () => null), published: options.published ?? (() => []) }));
  const call = async <T>(method: string, path: string, init: { as?: Account; body?: unknown; origin?: string } = {}) => {
    const headers: Record<string, string> = { "x-account": (init.as ?? alice).id };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.origin) headers.origin = init.origin;
    const response = await app.request(`http://localhost${path}`, { method, headers, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}) });
    return { status: response.status, ...((await response.json()) as Envelope<T>) };
  };
  return { database, content, app, call };
}

const menuInput = (name: string, people = 4) => ({ name, occasion: "Sunday lunch", people, items: [{ recipe_id: "dish_parippu" }, { recipe_id: "dish_chicken_curry", servings: 2 }] });

/** The fixture's dhal curry as a person would write it: the same lines, so the numbers can be checked against the corpus. */
const dhalInput = (overrides: Partial<UserRecipeInput> = {}): UserRecipeInput => ({
  name: "Amma's dhal",
  category: "pulses_and_eggs",
  summary: "Red lentils the way my mother makes them.",
  base_servings: 4,
  serving: { role: "with_rice", portion_g: 150, description: null },
  yield_g: 650,
  ingredients: [
    { ref: "product_red_dhal", label: { en: "red dhal", si: null, ta: null }, quantity: 200, unit: "g", household: "1 cup", preparation: null, optional: false, scaling: "linear", part: "main" },
    { ref: "product_big_onion", label: { en: "big onion", si: null, ta: null }, quantity: 1, unit: "piece", household: null, preparation: null, optional: false, scaling: "linear", part: "main" },
    { ref: "pantry_coconut_milk", label: { en: "coconut milk", si: null, ta: null }, quantity: 200, unit: "ml", household: null, preparation: null, optional: false, scaling: "linear", part: "main" },
    { ref: "product_salt", label: { en: "salt", si: null, ta: null }, quantity: 6, unit: "g", household: null, preparation: null, optional: false, scaling: "sublinear", part: "main" },
  ],
  steps: { en: [{ text: "Boil the dhal until soft.", minutes: 15 }, { text: "Add the onion and coconut milk and simmer.", minutes: 5 }, { text: "Season with salt.", minutes: null }], si: null, ta: null },
  times: { prep_minutes: 5, cook_minutes: 20, passive_minutes: 0 },
  equipment: [],
  tips: null,
  tags: ["budget"],
  visibility: "private",
  ...overrides,
});

const manifestFor = (id: string, name: string, adapter?: unknown) =>
  sourceManifestSchema.parse({
    id,
    name,
    owner: name,
    landing_url: `https://${id}.example/`,
    retrieval_method: adapter ? "api_snapshot" : "scheduled_download",
    expected_cadence: "daily",
    formats: [adapter ? "json" : "pdf"],
    geographic_scope: "t",
    price_types: [adapter ? "retail_online_store" : "wholesale_observed"],
    rights_status: "approved_permission",
    rights_evidence_ref: "docs",
    attribution_text: `Source: ${name}`,
    retention_policy: "preserve_source_evidence",
    parser_owner: "tests",
    reviewed_by: "tests",
    reviewed_at: "2026-01-01",
    review_due_at: "2099-01-01",
    request_interval_ms: 1000,
    max_attempts: 3,
    enabled: true,
    ...(adapter ? { adapter } : {}),
  });

test("menus: create, list newest first, read, update, delete, each scoped to the owning account", async () => {
  const { database, call } = harness();
  try {
    const first = await call<AccountMenu>("POST", "/v1/account/menus", { body: menuInput("Poya lunch") });
    assert.equal(first.status, 201);
    assert.equal(first.payload.name, "Poya lunch");
    assert.match(first.payload.id, /^menu_/u);
    assert.equal(first.payload.account_id, alice.id);
    assert.deepEqual(first.payload.items, [{ recipe_id: "dish_parippu", servings: null }, { recipe_id: "dish_chicken_curry", servings: 2 }], "defaults are filled on the way in");
    const second = await call<AccountMenu>("POST", "/v1/account/menus", { body: menuInput("Almsgiving", 30) });
    assert.equal(second.status, 201);

    const list = await call<{ items: AccountMenu[]; total: number; limit: number }>("GET", "/v1/account/menus");
    assert.equal(list.status, 200);
    assert.deepEqual(list.payload.items.map((menu) => menu.name), ["Almsgiving", "Poya lunch"], "newest first");
    assert.deepEqual([list.payload.total, list.payload.limit], [2, menuLimit]);
    assert.deepEqual((await call<{ items: AccountMenu[] }>("GET", "/v1/account/menus", { as: bob })).payload.items, [], "another account sees nothing of it");

    const read = await call<AccountMenu>("GET", `/v1/account/menus/${first.payload.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.payload.people, 4);
    const foreign = await call<null>("GET", `/v1/account/menus/${first.payload.id}`, { as: bob });
    assert.deepEqual([foreign.status, foreign.code], [404, "NOT_FOUND"], "a menu of another account is not found");

    const updated = await call<AccountMenu>("PUT", `/v1/account/menus/${first.payload.id}`, { body: { ...menuInput("Poya lunch, revised", 6), occasion: null } });
    assert.equal(updated.status, 200);
    assert.deepEqual([updated.payload.name, updated.payload.people, updated.payload.occasion], ["Poya lunch, revised", 6, null]);
    assert.equal(updated.payload.created_at, first.payload.created_at);
    assert.equal((await call("PUT", `/v1/account/menus/${first.payload.id}`, { as: bob, body: menuInput("Hijacked") })).status, 404);
    assert.equal((await call<AccountMenu>("GET", `/v1/account/menus/${first.payload.id}`)).payload.name, "Poya lunch, revised");
    assert.deepEqual((await call<{ items: AccountMenu[] }>("GET", "/v1/account/menus")).payload.items.map((menu) => menu.name), ["Poya lunch, revised", "Almsgiving"], "an edit brings a menu to the top");

    const invalid = await call<null>("POST", "/v1/account/menus", { body: { name: "x", people: 0, items: [] } });
    assert.equal(invalid.status, 400);
    assert.match(invalid.message, /^people: /u);
    assert.equal((await call("POST", "/v1/account/menus", { body: { ...menuInput("Bad"), items: [{ recipe_id: "not_a_dish" }] } })).status, 400);
    const notJson = await postRawBody(database, "/v1/account/menus", "{not json");
    assert.equal(notJson, 400);

    assert.equal((await call("DELETE", `/v1/account/menus/${first.payload.id}`, { as: bob })).status, 404, "another account cannot delete it");
    const deleted = await call<null>("DELETE", `/v1/account/menus/${first.payload.id}`);
    assert.deepEqual([deleted.status, deleted.message], [200, "Menu deleted"]);
    assert.equal((await call("GET", `/v1/account/menus/${first.payload.id}`)).status, 404);
    assert.equal((await call("DELETE", `/v1/account/menus/${first.payload.id}`)).status, 404);
  } finally {
    database.close();
  }
});

/** A POST with a body that is not JSON, through a fresh harness on the same database shape. */
async function postRawBody(database: ReturnType<typeof openOperationalDatabase>, path: string, body: string): Promise<number> {
  const content = createContentStore(database);
  const app = new Hono<ContentBindings>();
  app.use("*", async (context, next) => {
    context.set("account", alice);
    await next();
  });
  app.route("/v1/account", contentRoutes({ content, recipes: store, warehouse: async () => null, published: () => [] }));
  return (await app.request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json" }, body })).status;
}

test("menus stop at the account's limit with a clear message", async () => {
  const { database, content, call } = harness();
  try {
    for (let index = 0; index < menuLimit; index += 1) content.createMenu(alice.id, { name: `Menu ${index}`, occasion: null, people: 2, items: [] }, new Date("2026-09-01T00:00:00Z"));
    const refused = await call<null>("POST", "/v1/account/menus", { body: menuInput("One too many") });
    assert.equal(refused.status, 413);
    assert.equal(refused.message, `You can keep up to ${menuLimit} menus on an account; delete one to add another`);
    assert.equal((await call("POST", "/v1/account/menus", { as: bob, body: menuInput("Bob's first") })).status, 201, "the limit is per account");
    content.deleteMenu(alice.id, content.listMenus(alice.id)[0]!.id);
    assert.equal((await call("POST", "/v1/account/menus", { body: menuInput("Room again") })).status, 201);
  } finally {
    database.close();
  }
});

test("recipes: create, list summaries, read with a scaled view, update, delete; an unknown ingredient is refused by name", async () => {
  const { database, content, call } = harness();
  try {
    const created = await call<UserRecipe>("POST", "/v1/account/recipes", { body: dhalInput() });
    assert.equal(created.status, 201);
    assert.match(created.payload.id, /^dish_user_[0-9a-f]{32}$/u, "named like a dish, so a menu can hold it");
    assert.equal(created.payload.account_id, alice.id);
    assert.equal(created.payload.visibility, "private");
    assert.equal(created.payload.ingredients.length, 4);

    const unknown = await call<null>("POST", "/v1/account/recipes", { body: dhalInput({ ingredients: [...dhalInput().ingredients, { ref: "product_dragonfruit", label: { en: "dragonfruit", si: null, ta: null }, quantity: 1, unit: "piece", household: null, preparation: null, optional: false, scaling: "linear", part: "main" }] }) });
    assert.equal(unknown.status, 400);
    assert.match(unknown.message, /ingredients\.4\.ref: Unknown ingredient product_dragonfruit/u);
    const unregistered = await call<UserRecipe>("POST", "/v1/account/recipes", { body: dhalInput({ name: "Free-text line", ingredients: [{ ref: null, label: { en: "a secret spice", si: null, ta: null }, quantity: 5, unit: "g", household: null, preparation: null, optional: false, scaling: "linear", part: "main" }] }) });
    assert.equal(unregistered.status, 201, "a null ref names something the registry does not carry");
    assert.equal((await call<null>("POST", "/v1/account/recipes", { body: dhalInput({ category: "dessert" as never }) })).status, 400);

    const list = await call<{ items: Array<{ id: string; name: string; category: string; visibility: string }>; total: number; limit: number }>("GET", "/v1/account/recipes");
    assert.deepEqual(list.payload.items.map((item) => [item.name, item.category]), [["Free-text line", "pulses_and_eggs"], ["Amma's dhal", "pulses_and_eggs"]], "summaries from the columns, newest first");
    assert.equal("ingredients" in list.payload.items[0]!, false);
    assert.deepEqual([list.payload.total, list.payload.limit], [2, recipeLimit]);
    assert.deepEqual((await call<{ items: unknown[] }>("GET", "/v1/account/recipes", { as: bob })).payload.items, []);

    const scaled = await call<UserRecipe & { view: RecipeView }>("GET", `/v1/account/recipes/${created.payload.id}?servings=8`);
    assert.equal(scaled.status, 200);
    assert.equal(scaled.payload.name, "Amma's dhal", "the stored recipe comes with the view");
    assert.equal(scaled.payload.view.id, created.payload.id);
    assert.deepEqual([scaled.payload.view.servings, scaled.payload.view.base_servings], [8, 4]);
    assert.deepEqual(scaled.payload.view.ingredients.map((line) => [line.label.en, line.quantity]), [["red dhal", 400], ["big onion", 2], ["coconut milk", 400], ["salt", 10]], "linear lines double, salt grows sublinearly");
    assert.equal(scaled.payload.view.nutrition.per_serving.kcal, 281, "the same figures as the corpus dhal");
    assert.equal(scaled.payload.view.nutrition.servings, 8);
    assert.equal(scaled.payload.view.ingredients[0]!.names?.si, "පරිප්පු", "registry names come along");
    assert.equal(scaled.payload.view.cost, null, "no warehouse, no cost");
    assert.ok(scaled.payload.view.tags.includes("budget"));
    assert.deepEqual(scaled.payload.view.review, { en: false, si: false, ta: false });
    assert.deepEqual(scaled.payload.view.steps.en.map((step) => step.uses), [[0], [1, 2], [3]]);
    const base = await call<UserRecipe & { view: RecipeView }>("GET", `/v1/account/recipes/${created.payload.id}`);
    assert.equal(base.payload.view.servings, 4, "servings default to the recipe's own");
    assert.equal((await call<UserRecipe & { view: RecipeView }>("GET", `/v1/account/recipes/${created.payload.id}?servings=9999`)).payload.view.servings, 500);
    assert.equal((await call("GET", `/v1/account/recipes/${created.payload.id}`, { as: bob })).status, 404);

    const updated = await call<UserRecipe>("PUT", `/v1/account/recipes/${created.payload.id}`, { body: dhalInput({ name: "Amma's dhal, tempered", category: "vegetable", base_servings: 2 }) });
    assert.equal(updated.status, 200);
    assert.deepEqual([updated.payload.name, updated.payload.category, updated.payload.base_servings], ["Amma's dhal, tempered", "vegetable", 2]);
    assert.equal(updated.payload.created_at, created.payload.created_at);
    assert.deepEqual(content.listRecipes(alice.id).map((item) => [item.name, item.category])[0], ["Amma's dhal, tempered", "vegetable"], "the columns follow the recipe");
    assert.equal((await call("PUT", `/v1/account/recipes/${created.payload.id}`, { as: bob, body: dhalInput() })).status, 404);
    assert.equal((await call("PUT", `/v1/account/recipes/${created.payload.id}`, { body: dhalInput({ ingredients: [{ ...dhalInput().ingredients[0]!, ref: "pantry_nothing" }] }) })).status, 400);

    assert.equal((await call("DELETE", `/v1/account/recipes/${created.payload.id}`, { as: bob })).status, 404);
    assert.equal((await call("DELETE", `/v1/account/recipes/${created.payload.id}`)).status, 200);
    assert.equal((await call("GET", `/v1/account/recipes/${created.payload.id}`)).status, 404);

    for (let index = content.listRecipes(alice.id).length; index < recipeLimit; index += 1) content.createRecipe(alice.id, dhalInput({ name: `Recipe ${index}` }), new Date("2026-09-01T00:00:00Z"));
    const refused = await call<null>("POST", "/v1/account/recipes", { body: dhalInput() });
    assert.deepEqual([refused.status, refused.message], [413, `You can keep up to ${recipeLimit} recipes on an account; delete one to add another`]);
  } finally {
    database.close();
  }
});

test("a recipe's view carries today's cost when the warehouse prices one of its products", async () => {
  const operational = openOperationalDatabase(":memory:");
  seed(operational);
  const client = await warehouseFor(operational);
  const sources = [manifestFor("harti", "HARTI"), manifestFor("keells", "Keells", { kind: "keells_api", settings: {} }), manifestFor("cargills", "Cargills", { kind: "cargills_api", settings: {} })];
  const { database, call } = harness({ warehouse: async () => client, published: () => sources });
  try {
    const created = await call<UserRecipe>("POST", "/v1/account/recipes", { body: dhalInput() });
    const priced = await call<UserRecipe & { view: RecipeView }>("GET", `/v1/account/recipes/${created.payload.id}`);
    assert.equal(priced.status, 200);
    const cost = priced.payload.view.cost;
    assert.ok(cost, "a cost is computed");
    assert.equal(cost.lines.length, 1, "only the onion is priced in the seeded warehouse");
    assert.deepEqual([cost.lines[0]!.ref, cost.lines[0]!.unit_price, cost.lines[0]!.cost], ["product_big_onion", 255, 30.6], "one 120 g onion at the cheapest kilo price");
    assert.deepEqual(cost.unpriced, ["red dhal", "coconut milk", "salt"]);
    assert.equal(cost.estimated, true);
    assert.equal(priced.payload.view.ingredients[1]!.priced, true);
    assert.deepEqual(priced.payload.view.ingredients[1]!.purchase, { quantity: 0.12, unit: "kg" });
    const doubled = await call<UserRecipe & { view: RecipeView }>("GET", `/v1/account/recipes/${created.payload.id}?servings=8`);
    assert.equal(doubled.payload.view.cost?.total, 61.2, "cost scales with the headcount");

    const away = harness({ warehouse: async () => { throw new Error("warehouse down"); }, published: () => sources });
    try {
      const made = await away.call<UserRecipe>("POST", "/v1/account/recipes", { body: dhalInput() });
      const view = await away.call<UserRecipe & { view: RecipeView }>("GET", `/v1/account/recipes/${made.payload.id}`);
      assert.equal(view.status, 200);
      assert.equal(view.payload.view.cost, null, "a failing warehouse costs nothing, the view still answers");
    } finally {
      away.database.close();
    }
  } finally {
    database.close();
    await client.close();
    operational.close();
  }
});

test("writes need a verified address and the site's own origin; reads need only the account", async () => {
  const { database, call } = harness();
  try {
    assert.equal((await call("GET", "/v1/account/menus", { as: carol })).status, 200);
    assert.equal((await call("GET", "/v1/account/recipes", { as: carol })).status, 200);
    const refused = await call<null>("POST", "/v1/account/menus", { as: carol, body: menuInput("Not yet") });
    assert.deepEqual([refused.status, refused.code], [403, "EMAIL_NOT_VERIFIED"]);
    assert.equal((await call<null>("POST", "/v1/account/recipes", { as: carol, body: dhalInput() })).code, "EMAIL_NOT_VERIFIED");
    assert.equal((await call("DELETE", "/v1/account/menus/menu_x", { as: carol })).status, 403);

    const crossOrigin = await call<null>("POST", "/v1/account/menus", { body: menuInput("From elsewhere"), origin: "https://evil.example" });
    assert.deepEqual([crossOrigin.status, crossOrigin.message], [403, "Cross-origin request rejected"]);
    assert.equal((await call("POST", "/v1/account/menus", { body: menuInput("From here"), origin: "http://localhost" })).status, 201, "the site's own origin passes");
    assert.equal((await call("GET", "/v1/account/menus", { origin: "https://evil.example" })).status, 200, "reads are not state-changing");
  } finally {
    database.close();
  }
});

test("without a recipe corpus, recipes cannot be written and a stored recipe has no view", async () => {
  const withStore = harness();
  const { database, call } = harness({ recipes: undefined });
  try {
    assert.equal((await call("POST", "/v1/account/recipes", { body: dhalInput() })).status, 503);
    const saved = withStore.content.createRecipe(alice.id, dhalInput(), new Date());
    // The same row shape on the corpus-less harness: insert it there and read it back through the routes.
    const stored = withStore.database.prepare("SELECT recipe_json FROM account_recipe WHERE id = ?").get(saved.id) as { recipe_json: string };
    database.prepare("INSERT INTO account_recipe (id, account_id, name, category, recipe_json, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'private', ?, ?)").run(saved.id, alice.id, saved.name, saved.category, stored.recipe_json, saved.created_at, saved.updated_at);
    const read = await call<UserRecipe & { view: RecipeView | null }>("GET", `/v1/account/recipes/${saved.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.payload.view, null);
    assert.equal(read.payload.name, "Amma's dhal");
  } finally {
    database.close();
    withStore.database.close();
  }
});
