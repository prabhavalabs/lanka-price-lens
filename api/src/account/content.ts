import { randomUUID } from "node:crypto";

import { newId, type OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { accountMenuInputSchema, userRecipeInputSchema, type AccountMenu, type AccountMenuInput, type UserRecipe, type UserRecipeInput } from "@lanka-pricelens/shared";

/**
 * What a signed-in person keeps on the account: menus and own recipes, in the account_menu and
 * account_recipe tables of the operational SQLite database (created by foundry's migrate, DDL in
 * docs/accounts.md). Every read and write is scoped to the owning account, so another account's
 * menu is simply not found. Menu items and recipes are stored as JSON and pass through the shared
 * schemas both on the way in and on the way out, so a row that no longer fits the schema fails
 * loudly rather than reaching the site half-formed.
 */

/** How many menus and recipes one account may keep; beyond that a create is refused. */
export const menuLimit = 100;
export const recipeLimit = 200;

export class ContentLimitError extends Error {
  readonly kind: "menus" | "recipes";
  readonly limit: number;
  constructor(kind: "menus" | "recipes", limit: number) {
    super(`You can keep up to ${limit} ${kind} on an account; delete one to add another`);
    this.kind = kind;
    this.limit = limit;
  }
}

/** What the recipes list shows: the denormalised columns, without parsing every recipe's JSON. */
export type UserRecipeSummary = Pick<UserRecipe, "id" | "account_id" | "name" | "category" | "visibility" | "created_at" | "updated_at" | "base_servings" | "summary"> & { ingredient_count: number; minutes: number };

export type ContentCounts = { menus: number; recipes: number };

export type ContentStore = {
  /** The account's menus, most recently touched first. */
  listMenus: (accountId: string) => AccountMenu[];
  getMenu: (accountId: string, id: string) => AccountMenu | undefined;
  /** Throws ContentLimitError at the account's limit. */
  createMenu: (accountId: string, input: AccountMenuInput, now: Date) => AccountMenu;
  /** Undefined when the menu is not the account's. */
  updateMenu: (accountId: string, id: string, input: AccountMenuInput, now: Date) => AccountMenu | undefined;
  /** False when the menu is not the account's. */
  deleteMenu: (accountId: string, id: string) => boolean;
  /** The account's recipes, most recently touched first, as summaries. */
  listRecipes: (accountId: string) => UserRecipeSummary[];
  getRecipe: (accountId: string, id: string) => UserRecipe | undefined;
  /** Throws ContentLimitError at the account's limit. */
  createRecipe: (accountId: string, input: UserRecipeInput, now: Date) => UserRecipe;
  updateRecipe: (accountId: string, id: string, input: UserRecipeInput, now: Date) => UserRecipe | undefined;
  deleteRecipe: (accountId: string, id: string) => boolean;
  /** How many menus and recipes each of the given accounts keeps (zero for accounts with none), for the admin list. */
  countContent: (accountIds: string[]) => Map<string, ContentCounts>;
};

type MenuRow = { id: string; account_id: string; name: string; occasion: string | null; people: number; items_json: string; created_at: string; updated_at: string };
type RecipeRow = { id: string; account_id: string; name: string; category: string; recipe_json: string; visibility: string; created_at: string; updated_at: string };

/**
 * A user recipe is named like a dish (`dish_user_<uuid without dashes>`) so a menu can hold it
 * beside the corpus recipes, whose ids the menu schema checks against the dish pattern.
 */
export function newUserRecipeId(): string {
  return `dish_user_${randomUUID().replaceAll("-", "")}`;
}

const menuColumns = "id, account_id, name, occasion, people, items_json, created_at, updated_at";
const recipeColumns = "id, account_id, name, category, recipe_json, visibility, created_at, updated_at";

export function createContentStore(database: OperationalDatabase): ContentStore {
  const toMenu = (row: MenuRow): AccountMenu => {
    const menu = accountMenuInputSchema.parse({ name: row.name, occasion: row.occasion, people: row.people, items: JSON.parse(row.items_json) });
    return { ...menu, id: row.id, account_id: row.account_id, created_at: row.created_at, updated_at: row.updated_at };
  };
  const toRecipe = (row: RecipeRow): UserRecipe => {
    const recipe = userRecipeInputSchema.parse(JSON.parse(row.recipe_json));
    return { ...recipe, id: row.id, account_id: row.account_id, created_at: row.created_at, updated_at: row.updated_at };
  };
  const countRows = (table: "account_menu" | "account_recipe", accountId: string): number =>
    (database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id = ?`).get(accountId) as { count: number }).count;
  const getMenu = (accountId: string, id: string): AccountMenu | undefined => {
    const row = database.prepare(`SELECT ${menuColumns} FROM account_menu WHERE id = ? AND account_id = ?`).get(id, accountId) as MenuRow | undefined;
    return row ? toMenu(row) : undefined;
  };
  const getRecipe = (accountId: string, id: string): UserRecipe | undefined => {
    const row = database.prepare(`SELECT ${recipeColumns} FROM account_recipe WHERE id = ? AND account_id = ?`).get(id, accountId) as RecipeRow | undefined;
    return row ? toRecipe(row) : undefined;
  };

  return {
    listMenus: (accountId) => (database.prepare(`SELECT ${menuColumns} FROM account_menu WHERE account_id = ? ORDER BY updated_at DESC, rowid DESC`).all(accountId) as MenuRow[]).map(toMenu),
    getMenu,
    createMenu: (accountId, input, now) =>
      database.transaction(() => {
        if (countRows("account_menu", accountId) >= menuLimit) throw new ContentLimitError("menus", menuLimit);
        const menu = accountMenuInputSchema.parse(input);
        const id = newId("menu");
        const stamp = now.toISOString();
        database
          .prepare("INSERT INTO account_menu (id, account_id, name, occasion, people, items_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, accountId, menu.name, menu.occasion, menu.people, JSON.stringify(menu.items), stamp, stamp);
        return { ...menu, id, account_id: accountId, created_at: stamp, updated_at: stamp };
      })(),
    updateMenu: (accountId, id, input, now) => {
      const menu = accountMenuInputSchema.parse(input);
      const changed = database
        .prepare("UPDATE account_menu SET name = ?, occasion = ?, people = ?, items_json = ?, updated_at = ? WHERE id = ? AND account_id = ?")
        .run(menu.name, menu.occasion, menu.people, JSON.stringify(menu.items), now.toISOString(), id, accountId).changes;
      return changed ? getMenu(accountId, id) : undefined;
    },
    deleteMenu: (accountId, id) => database.prepare("DELETE FROM account_menu WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0,

    listRecipes: (accountId) =>
      (database
        .prepare(
          "SELECT id, account_id, name, category, visibility, created_at, updated_at, json_extract(recipe_json, '$.base_servings') AS base_servings, json_extract(recipe_json, '$.summary') AS summary, json_array_length(recipe_json, '$.ingredients') AS ingredient_count, COALESCE(json_extract(recipe_json, '$.times.prep_minutes'), 0) + COALESCE(json_extract(recipe_json, '$.times.cook_minutes'), 0) AS minutes FROM account_recipe WHERE account_id = ? ORDER BY updated_at DESC, rowid DESC",
        )
        .all(accountId) as UserRecipeSummary[]),
    getRecipe,
    createRecipe: (accountId, input, now) =>
      database.transaction(() => {
        if (countRows("account_recipe", accountId) >= recipeLimit) throw new ContentLimitError("recipes", recipeLimit);
        const recipe = userRecipeInputSchema.parse(input);
        const id = newUserRecipeId();
        const stamp = now.toISOString();
        database
          .prepare("INSERT INTO account_recipe (id, account_id, name, category, recipe_json, visibility, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
          .run(id, accountId, recipe.name, recipe.category, JSON.stringify(recipe), recipe.visibility, stamp, stamp);
        return { ...recipe, id, account_id: accountId, created_at: stamp, updated_at: stamp };
      })(),
    updateRecipe: (accountId, id, input, now) => {
      const recipe = userRecipeInputSchema.parse(input);
      const changed = database
        .prepare("UPDATE account_recipe SET name = ?, category = ?, recipe_json = ?, visibility = ?, updated_at = ? WHERE id = ? AND account_id = ?")
        .run(recipe.name, recipe.category, JSON.stringify(recipe), recipe.visibility, now.toISOString(), id, accountId).changes;
      return changed ? getRecipe(accountId, id) : undefined;
    },
    deleteRecipe: (accountId, id) => database.prepare("DELETE FROM account_recipe WHERE id = ? AND account_id = ?").run(id, accountId).changes > 0,

    countContent: (accountIds) => {
      const counts = new Map<string, ContentCounts>(accountIds.map((id) => [id, { menus: 0, recipes: 0 }]));
      if (!accountIds.length) return counts;
      const placeholders = accountIds.map(() => "?").join(", ");
      for (const [table, key] of [["account_menu", "menus"], ["account_recipe", "recipes"]] as const) {
        const rows = database.prepare(`SELECT account_id, COUNT(*) AS count FROM ${table} WHERE account_id IN (${placeholders}) GROUP BY account_id`).all(...accountIds) as Array<{ account_id: string; count: number }>;
        for (const row of rows) {
          const entry = counts.get(row.account_id);
          if (entry) entry[key] = row.count;
        }
      }
      return counts;
    },
  };
}
