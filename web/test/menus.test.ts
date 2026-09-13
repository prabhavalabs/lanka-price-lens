import assert from "node:assert/strict";
import test from "node:test";

import { addRecipe, createMenu, menuIn, removeMenu, removeRecipe, setServings, updateMenu, type MenusState } from "../src/store/menus.ts";

const now = "2026-09-13T06:00:00.000Z";

test("menus are created newest first, named, and clamped to a sane headcount", () => {
  let state: MenusState = { menus: [] };
  state = createMenu(state, { id: "m1", name: "  Sunday lunch ", people: 8, now });
  state = createMenu(state, { id: "m2", name: "", people: 0, occasion: " Poya ", now });
  assert.deepEqual(state.menus.map((menu) => [menu.id, menu.name, menu.people, menu.occasion]), [["m2", "Untitled menu", 1, "Poya"], ["m1", "Sunday lunch", 8, null]]);
  state = updateMenu(state, "m1", { people: 5000, name: "   " }, now);
  assert.deepEqual([state.menus[1]!.people, state.menus[1]!.name], [1000, "Sunday lunch"], "the name is kept when the new one is blank");
});

test("recipes are added once, scaled per item, and removed", () => {
  let state = createMenu({ menus: [] }, { id: "m1", name: "Lunch", people: 8, now });
  state = addRecipe(state, "m1", { id: "dish_parippu", label: "Dhal curry" }, now);
  state = addRecipe(state, "m1", { id: "dish_parippu", label: "Dhal curry" }, now);
  state = addRecipe(state, "m1", { id: "dish_pol_sambol", label: "Pol sambol" }, now);
  assert.deepEqual(state.menus[0]!.items.map((item) => [item.recipe_id, item.servings]), [["dish_parippu", null], ["dish_pol_sambol", null]]);
  state = setServings(state, "m1", "dish_pol_sambol", 4, now);
  assert.equal(state.menus[0]!.items[1]!.servings, 4);
  state = setServings(state, "m1", "dish_pol_sambol", null, now);
  assert.equal(state.menus[0]!.items[1]!.servings, null, "null follows the headcount again");
  assert.deepEqual(menuIn(state, "dish_parippu").map((menu) => menu.id), ["m1"]);
  state = removeRecipe(state, "m1", "dish_parippu", now);
  assert.deepEqual(state.menus[0]!.items.map((item) => item.recipe_id), ["dish_pol_sambol"]);
  state = removeMenu(state, "m1");
  assert.deepEqual(state.menus, []);
});
