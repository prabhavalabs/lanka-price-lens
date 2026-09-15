import { dietChoices, explainPick, pickSurprise, preferencesSchema, type AccountPreferences, type DishFacts } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";

import type { Account } from "./account/types.ts";
import { envelope } from "./http.ts";
import type { RecipeIndexEntry } from "./recipe-views.ts";
import type { RecipeStore } from "./recipes.ts";

/**
 * Surprise me: one dish with a full recipe, drawn for the visitor (docs/newsletters.md). Mounted by
 * app.ts at /v1/public/recipes/surprise, before the /:id route and behind readAccount, so a
 * signed-in person's food preferences apply and a guest gets the catalogue defaults, narrowed by
 * `?diet=` when given. The answer is never cached: it is random and, with a session, personal.
 */

export type SurpriseBindings = { Variables: { account?: Account | undefined; requestId: string } };

export type SurpriseDeps = {
  recipes: RecipeStore;
  /** Every dish that has a full recipe, with its computed metrics (`buildRecipeIndex`). */
  index: Map<string, RecipeIndexEntry>;
};

export type SurprisePick = { id: string; name: string; reasons: string[] };

/** How many ids `exclude` may carry; the site sends the ones shown in the tab. */
export const maxExcluded = 50;

const dishIdPattern = /^dish_[a-z0-9]+(?:_[a-z0-9]+)*$/u;

function fail(context: Context<SurpriseBindings>, status: 404, code: "NO_MATCH", message: string) {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), code }, status);
}

/** The facts the recommendation reads, taken from an index entry: the catalogue's diet, the recipe's tags and times, the computed calories. */
export function dishFactsOf(entry: RecipeIndexEntry): DishFacts {
  const { dish, recipe, metrics } = entry;
  return {
    id: dish.id,
    category: dish.category,
    diet: [...dish.diet],
    tags: [...metrics.tags],
    kcal_per_serving: metrics.coverage.with_nutrition > 0 ? metrics.kcal : null,
    minutes: recipe.times.prep_minutes + recipe.times.cook_minutes + recipe.times.passive_minutes,
    popularity: dish.popularity,
  };
}

/** The ids in a comma-separated `exclude`, well formed and deduplicated, at most `maxExcluded`. */
export function parseExclude(value: string | undefined): string[] {
  if (!value) return [];
  return [...new Set(value.split(",").map((id) => id.trim()).filter((id) => dishIdPattern.test(id)))].slice(0, maxExcluded);
}

/** A guest's preferences: the defaults, with the diet from the query when it names a known choice. */
export function guestPreferences(diet: string | undefined): AccountPreferences {
  return preferencesSchema.parse(diet && (dietChoices as readonly string[]).includes(diet) ? { diet } : {});
}

export function surpriseRoutes(deps: SurpriseDeps) {
  const app = new Hono<SurpriseBindings>();
  // The facts never change after start (the store is read once), so they are built on the first request and kept.
  let facts: DishFacts[] | null = null;
  const candidates = () => (facts ??= deps.recipes.catalogue.dishes.flatMap((dish) => {
    const entry = deps.index.get(dish.id);
    return entry ? [dishFactsOf(entry)] : [];
  }));
  app.get("/", (context) => {
    const account = context.get("account");
    const preferences = account ? account.preferences : guestPreferences(context.req.query("diet"));
    const seed = context.req.query("seed")?.trim().slice(0, 100);
    const pick = pickSurprise(candidates(), preferences, { exclude: parseExclude(context.req.query("exclude")), ...(seed ? { seed } : {}) });
    context.header("Cache-Control", "no-store");
    if (!pick) return fail(context, 404, "NO_MATCH", "Nothing in the recipes fits those preferences yet");
    const name = deps.index.get(pick.id)?.dish.names.en ?? pick.id;
    const payload: SurprisePick = { id: pick.id, name, reasons: explainPick(pick, preferences) };
    return context.json(envelope(context.get("requestId"), payload));
  });
  return app;
}
