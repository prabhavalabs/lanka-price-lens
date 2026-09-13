import assert from "node:assert/strict";
import test from "node:test";

import { addRecipe, createMenu, fromAccountMenu, labelFromRecipeId, labelsOf, maxItems, parseStoredMenus, rememberDishLabels, toMenuInput, type Menu } from "../src/store/menus.ts";

const now = "2026-09-13T06:00:00.000Z";

test("a menu goes to the account as exactly the shared schema's fields, trimmed and clamped", () => {
  let state = createMenu({ menus: [] }, { id: "local", name: "  Sunday lunch ", people: 8, occasion: " Family ", now });
  state = addRecipe(state, "local", { id: "dish_parippu", label: "Dhal curry" }, now);
  const menu = { ...state.menus[0]!, name: `${"x".repeat(130)}`, items: [...state.menus[0]!.items, { recipe_id: "dish_pol_sambol", label: "Pol sambol", servings: 5000 }] };
  const input = toMenuInput(menu);
  assert.deepEqual(Object.keys(input).sort(), ["items", "name", "occasion", "people"], "no id, stamps, or labels leave the browser");
  assert.equal(input.name.length, 120);
  assert.equal(input.occasion, "Family");
  assert.deepEqual(input.items, [{ recipe_id: "dish_parippu", servings: null }, { recipe_id: "dish_pol_sambol", servings: 1000 }]);
  assert.equal(toMenuInput({ ...menu, name: "   ", occasion: "  " }).name, "Untitled menu");
  assert.equal(toMenuInput({ ...menu, occasion: "  " }).occasion, null);
});

test("a menu from the account names its recipes: a known label first, else a name read off the id", () => {
  rememberDishLabels({ dish_kiri_bath: { en: "Kiribath" } });
  const menu = fromAccountMenu({ id: "menu_1", account_id: "account_1", name: "Poya", occasion: null, people: 30, items: [{ recipe_id: "dish_parippu", servings: null }, { recipe_id: "dish_pol_sambol", servings: 12 }, { recipe_id: "dish_kiri_bath", servings: null }], created_at: now, updated_at: now }, { dish_parippu: "Dhal curry" });
  assert.deepEqual(menu.items.map((item) => [item.recipe_id, item.label, item.servings]), [["dish_parippu", "Dhal curry", null], ["dish_pol_sambol", "Pol sambol", 12], ["dish_kiri_bath", "Kiribath", null]]);
  assert.equal(labelFromRecipeId("dish_chicken_curry"), "Chicken curry");
  assert.equal(labelFromRecipeId("dish_"), "dish_");
  assert.deepEqual(labelsOf([menu]), { dish_parippu: "Dhal curry", dish_kiri_bath: "Kiribath" }, "labels that only echo the id are not worth remembering");
});

test("menus kept in the browser before accounts are read leniently", () => {
  const stored: Menu[] = parseStoredMenus(JSON.stringify([{ id: "m1", name: "Lunch", people: 6, items: [{ recipe_id: "dish_parippu" }, { recipe_id: 7 }, { recipe_id: "dish_x", label: "X", servings: 2 }], created_at: now }, { name: "no id" }, "junk"]));
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]!.items.map((item) => [item.recipe_id, item.label, item.servings]), [["dish_parippu", "Parippu", null], ["dish_x", "X", 2]]);
  assert.deepEqual(parseStoredMenus("{not json"), []);
  assert.deepEqual(parseStoredMenus(null), []);
  assert.ok(Array.from({ length: maxItems + 5 }).length > maxItems);
});
