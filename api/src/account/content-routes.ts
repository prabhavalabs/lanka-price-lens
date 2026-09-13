import type { WarehouseClient } from "@lanka-pricelens/foundry/warehouse";
import { accountMenuInputSchema, userRecipeInputSchema, type Dish, type PriceLookup, type Recipe, type SourceManifest, type UserRecipe } from "@lanka-pricelens/shared";
import { Hono, type Context } from "hono";

import { envelope, jsonObject, sameOrigin } from "../http.ts";
import { buildRecipeIndex, priceLookupFor, priceOptions, pricedProductIds, recipeView, type RecipeView } from "../recipe-views.ts";
import type { RecipeStore } from "../recipes.ts";
import { ContentLimitError, menuLimit, recipeLimit, type ContentStore } from "./content.ts";
import type { Account, AccountErrorCode } from "./types.ts";

/**
 * The routes for what an account keeps: menus and own recipes, mounted by app.ts at
 * /v1/account behind requireAccount, which puts the account on the context and answers 401 and
 * 403 itself. Reads need only the account; writes also need a verified address and refuse
 * cross-origin requests. A recipe's view (scaled lines, nutrition, today's cost) is computed
 * the way the corpus recipe endpoint computes it, with the same registry and the same prices.
 */

export type ContentBindings = { Variables: { account: Account; requestId: string } };

export type ContentDeps = {
  content: ContentStore;
  /** The corpus store, for the ingredient registry; undefined when recipes are not configured. */
  recipes: RecipeStore | undefined;
  warehouse: () => Promise<WarehouseClient | null>;
  /** The sources whose prices may be shown. */
  published: () => SourceManifest[];
};

type FailureStatus = 400 | 401 | 403 | 404 | 413 | 503;

function fail(context: Context<ContentBindings>, status: FailureStatus, message: string, code?: AccountErrorCode) {
  return context.json({ ...envelope(context.get("requestId"), null, false, message), ...(code ? { code } : {}) }, status);
}

/** The first validation issue as "path: message", the way the menu computation reports one. */
function issueMessage(error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.map(String).join(".") || fallback}: ${issue.message}` : `Invalid ${fallback}`;
}

/** The corpus shape of a user recipe: the same facts with the review flags off, so the recipe math treats it like any other. */
export function userRecipeAsRecipe(recipe: UserRecipe): Recipe {
  return {
    id: recipe.id,
    base_servings: recipe.base_servings,
    serving: recipe.serving,
    yield_g: recipe.yield_g,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    times: recipe.times,
    equipment: recipe.equipment,
    tips: recipe.tips,
    health_note: null,
    tags: recipe.tags,
    review_needed: [],
    review: { en: false, si: false, ta: false },
  };
}

const dishRoleFor: Record<Recipe["serving"]["role"], Dish["roles"][number]> = { with_rice: "side", main: "main", side: "side", staple: "staple", snack: "snack", sweet: "sweet", drink: "drink", condiment: "condiment", breakfast: "main" };

/** A catalogue entry standing in for the user's recipe, so the index can be built over it. */
function dishStubFor(recipe: UserRecipe, corpus: Recipe): Dish {
  return {
    id: recipe.id,
    names: { en: recipe.name, si: null, si_latn: null, ta: null, ta_latn: null },
    category: recipe.category,
    roles: [dishRoleFor[recipe.serving.role]],
    meal_slots: ["lunch", "dinner"],
    region: "island_wide",
    popularity: 3,
    prep_minutes: recipe.times.prep_minutes,
    cook_minutes: recipe.times.cook_minutes,
    difficulty: "easy",
    diet: [],
    protein_source: [],
    spice: "none",
    key_ingredients: pricedProductIds([corpus]),
    other_ingredients: [],
    summary: recipe.summary ?? recipe.name,
    occasions: [],
    variants: [],
    pairs_with: [],
  };
}

/** The user's recipe scaled to `servings` with nutrition and cost, through a one-entry index over the corpus registry. */
export function userRecipeView(store: RecipeStore, recipe: UserRecipe, servings: number, prices: PriceLookup | null): RecipeView | null {
  const corpus = userRecipeAsRecipe(recipe);
  const one: RecipeStore = { ...store, catalogue: { ...store.catalogue, dishes: [dishStubFor(recipe, corpus)] }, recipes: new Map([[corpus.id, corpus]]) };
  return recipeView(one, buildRecipeIndex(one), corpus.id, servings, prices);
}

/** The index of the first ingredient line whose ref the registry does not carry, or -1. */
export function unknownIngredientIndex(ingredients: UserRecipe["ingredients"], registry: Map<string, unknown>): number {
  return ingredients.findIndex((line) => line.ref !== null && !registry.has(line.ref));
}

export function contentRoutes(deps: ContentDeps): Hono<ContentBindings> {
  const app = new Hono<ContentBindings>();

  /** Today's prices for one recipe's products, or null when the warehouse is away (the view then has no cost). */
  const pricesFor = async (recipe: Recipe): Promise<PriceLookup | null> => {
    if (!deps.recipes) return null;
    try {
      const client = await deps.warehouse();
      if (!client) return null;
      return priceLookupFor(await priceOptions(client, deps.published(), pricedProductIds([recipe])), deps.recipes.registry);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "Recipe prices unavailable", detail: error instanceof Error ? error.message : String(error) }));
      return null;
    }
  };

  app.use("*", async (context, next) => {
    if (!context.get("account")) return fail(context, 401, "Sign in to continue");
    if (context.req.method === "GET" || context.req.method === "HEAD") return next();
    if (!sameOrigin(context)) return fail(context, 403, "Cross-origin request rejected");
    if (!context.get("account").email_verified_at) return fail(context, 403, "Verify your email address to keep menus and recipes", "EMAIL_NOT_VERIFIED");
    return next();
  });

  app.get("/menus", (context) => {
    const items = deps.content.listMenus(context.get("account").id);
    return context.json(envelope(context.get("requestId"), { items, total: items.length, limit: menuLimit }));
  });
  app.post("/menus", async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = accountMenuInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "menu"));
    try {
      return context.json(envelope(context.get("requestId"), deps.content.createMenu(context.get("account").id, parsed.data, new Date()), true, "Menu saved"), 201);
    } catch (error) {
      if (error instanceof ContentLimitError) return fail(context, 413, error.message);
      throw error;
    }
  });
  app.get("/menus/:id", (context) => {
    const menu = deps.content.getMenu(context.get("account").id, context.req.param("id").slice(0, 120));
    if (!menu) return fail(context, 404, "Menu not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), menu));
  });
  app.put("/menus/:id", async (context) => {
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = accountMenuInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "menu"));
    const menu = deps.content.updateMenu(context.get("account").id, context.req.param("id").slice(0, 120), parsed.data, new Date());
    if (!menu) return fail(context, 404, "Menu not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), menu, true, "Menu saved"));
  });
  app.delete("/menus/:id", (context) => {
    if (!deps.content.deleteMenu(context.get("account").id, context.req.param("id").slice(0, 120))) return fail(context, 404, "Menu not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), null, true, "Menu deleted"));
  });

  app.get("/recipes", (context) => {
    const items = deps.content.listRecipes(context.get("account").id);
    return context.json(envelope(context.get("requestId"), { items, total: items.length, limit: recipeLimit }));
  });
  /** The body as a user recipe, or the response that refuses it. */
  const readRecipe = async (context: Context<ContentBindings>) => {
    if (!deps.recipes) return fail(context, 503, "Recipes are not available");
    const body = await jsonObject(context);
    if (!body) return fail(context, 400, "Body must be JSON");
    const parsed = userRecipeInputSchema.safeParse(body);
    if (!parsed.success) return fail(context, 400, issueMessage(parsed.error, "recipe"));
    const unknown = unknownIngredientIndex(parsed.data.ingredients, deps.recipes.registry);
    if (unknown >= 0) return fail(context, 400, `ingredients.${unknown}.ref: Unknown ingredient ${parsed.data.ingredients[unknown]!.ref}; pick one from the registry or leave ref empty`);
    return parsed.data;
  };
  app.post("/recipes", async (context) => {
    const recipe = await readRecipe(context);
    if (recipe instanceof Response) return recipe;
    try {
      return context.json(envelope(context.get("requestId"), deps.content.createRecipe(context.get("account").id, recipe, new Date()), true, "Recipe saved"), 201);
    } catch (error) {
      if (error instanceof ContentLimitError) return fail(context, 413, error.message);
      throw error;
    }
  });
  app.get("/recipes/:id", async (context) => {
    const recipe = deps.content.getRecipe(context.get("account").id, context.req.param("id").slice(0, 120));
    if (!recipe) return fail(context, 404, "Recipe not found", "NOT_FOUND");
    const servings = Math.min(500, Math.max(1, Math.round(Number(context.req.query("servings") ?? recipe.base_servings) || recipe.base_servings)));
    const view = deps.recipes ? userRecipeView(deps.recipes, recipe, servings, await pricesFor(userRecipeAsRecipe(recipe))) : null;
    return context.json(envelope(context.get("requestId"), { ...recipe, view }));
  });
  app.put("/recipes/:id", async (context) => {
    const recipe = await readRecipe(context);
    if (recipe instanceof Response) return recipe;
    const saved = deps.content.updateRecipe(context.get("account").id, context.req.param("id").slice(0, 120), recipe, new Date());
    if (!saved) return fail(context, 404, "Recipe not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), saved, true, "Recipe saved"));
  });
  app.delete("/recipes/:id", (context) => {
    if (!deps.content.deleteRecipe(context.get("account").id, context.req.param("id").slice(0, 120))) return fail(context, 404, "Recipe not found", "NOT_FOUND");
    return context.json(envelope(context.get("requestId"), null, true, "Recipe deleted"));
  });

  return app;
}
