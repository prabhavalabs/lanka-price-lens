import type { OperationalDatabase } from "@lanka-pricelens/foundry/db";
import { favouriteDishIdPattern, favouriteLimit, type FavouriteEntry, type FavouriteRecipe } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";

import { envelope, sameOrigin } from "../http.ts";
import type { RecipeStore } from "../recipes.ts";
import type { Account, AccountErrorCode } from "./types.ts";

/**
 * Favourite recipes: dishes a person hearts on a card or the recipe page to find again on the
 * account page (docs/accounts.md). One row per account and dish, a session is enough, and the
 * list answers with what the catalogue says about each dish so the page can show it.
 */

export class FavouriteLimitError extends Error {}

export type FavouriteStore = {
  /** The account's favourites, newest first. */
  list: (accountId: string) => FavouriteRecipe[];
  has: (accountId: string, dishId: string) => boolean;
  count: (accountId: string) => number;
  /** Adds the dish; a dish already there keeps its row. Throws FavouriteLimitError when the list is full. */
  add: (accountId: string, dishId: string, now: Date) => FavouriteRecipe;
  /** False when the dish was not a favourite. */
  remove: (accountId: string, dishId: string) => boolean;
  /** How many favourites each of the given accounts has (zero for none), for the admin list. */
  countFor: (accountIds: string[]) => Map<string, number>;
};

type Row = { dish_id: string; created_at: string };

export function createFavouriteStore(database: OperationalDatabase): FavouriteStore {
  const get = (accountId: string, dishId: string): FavouriteRecipe | undefined => database.prepare("SELECT dish_id, created_at FROM account_favourite WHERE account_id = ? AND dish_id = ?").get(accountId, dishId) as Row | undefined;
  const count = (accountId: string): number => (database.prepare("SELECT COUNT(*) AS count FROM account_favourite WHERE account_id = ?").get(accountId) as { count: number }).count;
  return {
    list: (accountId) => database.prepare("SELECT dish_id, created_at FROM account_favourite WHERE account_id = ? ORDER BY created_at DESC, dish_id").all(accountId) as Row[],
    has: (accountId, dishId) => get(accountId, dishId) !== undefined,
    count,
    add: (accountId, dishId, now) => {
      const existing = get(accountId, dishId);
      if (existing) return existing;
      if (count(accountId) >= favouriteLimit) throw new FavouriteLimitError(`Favourites hold up to ${favouriteLimit} recipes`);
      database.prepare("INSERT INTO account_favourite (account_id, dish_id, created_at) VALUES (?, ?, ?)").run(accountId, dishId, now.toISOString());
      return get(accountId, dishId)!;
    },
    remove: (accountId, dishId) => database.prepare("DELETE FROM account_favourite WHERE account_id = ? AND dish_id = ?").run(accountId, dishId).changes > 0,
    countFor: (accountIds) => {
      const counts = new Map<string, number>(accountIds.map((id) => [id, 0]));
      if (!accountIds.length) return counts;
      const placeholders = accountIds.map(() => "?").join(", ");
      for (const row of database.prepare(`SELECT account_id, COUNT(*) AS count FROM account_favourite WHERE account_id IN (${placeholders}) GROUP BY account_id`).all(...accountIds) as Array<{ account_id: string; count: number }>) counts.set(row.account_id, row.count);
      return counts;
    },
  };
}

export type FavouriteBindings = { Variables: { account: Account; requestId: string } };

export type FavouriteRouteDeps = {
  store: FavouriteStore;
  /** The catalogue, to refuse unknown dishes and to describe each favourite. */
  recipes: RecipeStore | undefined;
  now?: (() => Date) | undefined;
};

type FailureStatus = 400 | 403 | 404 | 413;

function fail(context: Context<FavouriteBindings>, status: FailureStatus, message: string, code?: AccountErrorCode | "NOT_FOUND") {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), ...(code ? { code } : {}) }, status);
}

/** What the account page shows beside a favourite: the dish's name and the facts on its card. */
export function describeFavourite(favourite: FavouriteRecipe, recipes: RecipeStore | undefined): FavouriteEntry {
  const dish = recipes?.catalogue.dishes.find((candidate) => candidate.id === favourite.dish_id);
  return { ...favourite, dish: dish ? { id: dish.id, name: dish.names.en, category: dish.category, summary: dish.summary, minutes: dish.prep_minutes + dish.cook_minutes, difficulty: dish.difficulty } : null };
}

/** Mounted at /v1/account/favourites behind requireAccount; a session is enough, no verified address needed. */
export function favouriteRoutes(deps: FavouriteRouteDeps): Hono<FavouriteBindings> {
  const app = new Hono<FavouriteBindings>();
  const clock = deps.now ?? (() => new Date());
  const dishIdOf = (context: Context<FavouriteBindings>): string | null => {
    const dishId = (context.req.param("dishId") ?? "").slice(0, 120);
    if (!favouriteDishIdPattern.test(dishId)) return null;
    if (deps.recipes && !deps.recipes.catalogue.dishes.some((dish) => dish.id === dishId)) return null;
    return dishId;
  };

  app.use("*", async (context, next) => {
    if (context.req.method !== "GET" && !sameOrigin(context)) return fail(context, 403, "Cross-origin request rejected");
    return next();
  });

  app.get("/", (context) => {
    const items = deps.store.list(context.get("account").id).map((favourite) => describeFavourite(favourite, deps.recipes));
    return context.json(envelope(context.get("requestId"), { items, total: items.length, limit: favouriteLimit }));
  });

  app.put("/:dishId", (context) => {
    const dishId = dishIdOf(context);
    if (!dishId) return fail(context, 404, "Recipe not found", "NOT_FOUND");
    try {
      const favourite = deps.store.add(context.get("account").id, dishId, clock());
      return context.json(envelope(context.get("requestId"), describeFavourite(favourite, deps.recipes), true, "Added to your favourites"));
    } catch (error) {
      if (error instanceof FavouriteLimitError) return fail(context, 413, error.message);
      throw error;
    }
  });

  app.delete("/:dishId", (context) => {
    const dishId = (context.req.param("dishId") ?? "").slice(0, 120);
    if (!favouriteDishIdPattern.test(dishId) || !deps.store.remove(context.get("account").id, dishId)) return fail(context, 404, "That recipe is not among your favourites", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), null, true, "Removed from your favourites"));
  });

  return app;
}
